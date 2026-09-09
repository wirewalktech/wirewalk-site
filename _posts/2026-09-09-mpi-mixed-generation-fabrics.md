---
title: "EDR to XDR in one fabric: rate reporting, width traps, and the node that gates the job"
date: 2026-09-09 09:00:00 -0400
category: Fabric
tags: [InfiniBand, EDR, HDR, NDR, XDR, mlxlink]
summary: >-
  Different tools report link speed in different units, half the field is
  per-lane, and a link that negotiated two lanes instead of four is Active and
  silent. On a synchronised collective, one such link sets the speed of the
  entire job.
---

Clusters accumulate generations. An EDR island from 2017 that still runs
production, an HDR expansion, an NDR refresh, and now XDR arriving for the GPU
tier — frequently all reachable from one another, sometimes in one subnet. Mixed
fabrics work. What does not work is reasoning about them from a mental model
built on a single generation, because the reporting is inconsistent and the
failure modes are quiet.

## The rate table, and which number each tool prints

The confusion is entirely avoidable and it costs people days.

| Generation | Lanes | Per-lane signalling | 4X link rate | Encoding |
|---|---|---|---|---|
| FDR | 4 | 14.0625 Gb/s | 56 Gb/s | 64b/66b |
| EDR | 4 | 25.78125 Gb/s | 100 Gb/s | 64b/66b |
| HDR | 4 | 53.125 Gb/s | 200 Gb/s | PAM4, 64b/66b + RS-FEC |
| NDR | 4 | 106.25 Gb/s | 400 Gb/s | PAM4, RS-FEC |
| XDR | 4 | 212.5 Gb/s | 800 Gb/s | PAM4, RS-FEC |

Now the part that matters. `ibstat` prints the **aggregate link rate**:

```
	Rate: 400
```

`ibstatus` prints the aggregate rate and helpfully names the generation:

```
	rate:            400 Gb/sec (4X NDR)
```

`iblinkinfo` prints the **width and the per-lane rate as separate fields**:

```
  37   12[  ] ==( 4X 106.25 Gbps Active/  LinkUp)==>  91   1[  ] "node17 mlx5_0" ( )
```

That is a 400 Gb/s link. Read the `106.25` as the link rate and you conclude
your NDR fabric is running at roughly 100 Gb/s, which is a conclusion people
reach, escalate, and occasionally publish. The `4X` prefix is doing the work and
it is easy to skim past.

On a mixed fabric this is worse, because `4X 106.25 Gbps` (NDR400) and
`4X 25.78125 Gbps` (EDR100) look superficially similar in a long scan and the
distinguishing digits are in the middle of the field.

<div class="note" markdown="1">
The rule that keeps this straight: `ibstat` and `ibstatus` report the link, and
`iblinkinfo` reports a lane. Whenever you quote a number from `iblinkinfo`,
quote the width with it. A capacity claim sourced from that field without the
`4X` attached is wrong by a factor of four, and it is wrong in the direction
that makes people buy hardware.
</div>

## The width trap

Width is the field that silently costs you three quarters of a link.

An InfiniBand link can negotiate 1X, 2X or 4X. A link that comes up at 1X is
`Active`, `LinkUp`, routable, pingable, and passes every functional test. It runs
at a quarter rate. Nothing logs an error, because from the fabric's point of view
nothing is wrong — the two ends negotiated the best width they could agree on,
and that is what negotiation is for.

Causes: a damaged or partially seated cable, a transceiver with a failed lane, a
splitter cable in a port that is not configured to split, or a port configured to
split that has a straight cable in it.

The scan to run across the whole fabric, on a schedule:

```bash
iblinkinfo -l | awk '$0 !~ /4X/ && /Active/ {print}'
```

And the more useful version, which catches both narrow links and links that
negotiated a lower generation than they should have:

```bash
iblinkinfo -l | grep -oE '[0-9]+X +[0-9.]+ Gbps' | tr -s ' ' | sort | uniq -c | sort -rn
```

That gives you a histogram of every distinct width-and-rate combination in the
fabric. On a homogeneous fabric it should have one row. On a mixed fabric it
should have exactly as many rows as you have generations, and every count should
match what you cabled. Any row with a small count is the anomaly, and small
counts are the whole point of the histogram.

## HDR100 and the two ways to get it

HDR100 is the case where the same nominal rate arrives by two different physical
arrangements, and the difference matters when you are diagnosing.

An HDR switch port carries four HDR lanes. Split, it presents as two ports of two
lanes each — HDR100, reported as `2X 53.125 Gbps`. Separately, there are HDR100
adapters, which are physically capable of two lanes only and report `2X` even
into an unsplit port.

So `2X 53.125 Gbps` is normal and expected on a split fabric with HDR100
adapters, and is a fault on a fabric where you believed everything was HDR200.
The histogram above is what tells you which situation you are in; the individual
port reading does not.

Three practical consequences:

- A single HDR200 adapter plugged into a split HDR100 port runs at 100. Half of
  the adapter is unused and nothing reports it.
- A single HDR100 adapter plugged into an unsplit HDR200 port also runs at 100,
  and wastes half a switch port.
- Cable compatibility is not guaranteed across these arrangements. Active optical
  cables in particular have power class requirements that some port and adapter
  combinations do not satisfy, and the symptom is a port that will not come out of
  Polling with no error message that explains why. Check the transceiver
  explicitly before assuming a bad cable:

```bash
mlxlink -d mlx5_0 -p 1 -m
```

That reports the module's vendor, part number, type and supported rates, which
is the information the failure message does not give you.

## When one node gates the job

This is the expensive lesson, and it is the reason the width scan belongs on a
schedule rather than in a runbook.

A synchronised collective — allreduce, alltoall, a barrier before a timing
region — completes when its slowest participant completes. The whole job
proceeds at the rate of its worst link. One node at 2X in a 32-node NDR
allocation does not cost you one thirty-second of the throughput. Depending on
the communication pattern, it can cost a large fraction of it, because every
other rank waits.

What makes it expensive is not the degradation, it is the presentation. The
symptom is:

- Results that vary between runs by a wide margin.
- The variation correlating with nothing you changed.
- Point-to-point tests that are clean, because the odds of any given pair
  including the bad node are low.
- Fabric-wide diagnostics that report no errors, because a narrow link is not an
  error.

It presents as a fabric-wide capacity problem. It gets investigated as one. The
routing engine gets blamed, ISL capacity gets blamed, a purchase order for more
spine ports gets discussed — and the actual finding is one transceiver.

The tell is the correlation with allocation. If you keep the node list with every
result, the correlation is visible in an afternoon. If you do not, it is not
visible at all, which is why the earlier articles in this series keep insisting
on recording the node list.

The other tell is arithmetic. If a synchronised benchmark comes in at close to a
clean fraction of expectation — half, a quarter — suspect a width negotiation
before suspecting anything subtle. Fabrics rarely degrade by exactly 50 percent
for interesting reasons.

## Mixing generations in one subnet

Several things happen that are worth anticipating.

**Links negotiate down to the lower common generation.** An NDR adapter into an
HDR switch port gives HDR, with the appropriate cable. That is correct behaviour
and it is only a problem when nobody recorded the intent, and a year later
somebody is trying to work out why a node is at 200 when the inventory says 400.

**Path MTU is set by the minimum along the path.** OpenSM computes per-path MTU,
so a subnet containing something that supports only 2048 will have paths through
it at 2048 while other paths run at 4096. Two node pairs then produce different
`ib_write_bw` headers on the same fabric, which is confusing if you have not
seen it before. Check the SM's configured maximum and the per-device capability:

```bash
grep -i max_mtu /etc/opensm/opensm.conf
ibv_devinfo -v | grep -E 'max_mtu|active_mtu'
```

**Service levels and virtual lanes may differ.** The number of data VLs a device
supports varies across generations. If you use QoS and service-level mapping,
the mapping has to be valid on the least capable device in the path, and an
invalid mapping does not fail loudly — traffic lands on VL0 with everything
else.

**The routing engine is constrained by the least regular part of the fabric.**
`ftree` requires a regular fat tree; an older island bolted on with a different
uplink ratio is exactly the sort of irregularity that makes it decline and fall
back to `updn`, fabric-wide. So adding a generation can change the routing of
the parts you did not touch.

**Forwarding table capacity is set by the oldest switch.** Every switch needs an
entry for every LID it must reach. The smallest table in the fabric governs, and
older switches have smaller tables. The article on LID budgets in this series
covers the arithmetic.

## Firmware skew across a mixed fleet

Mixed generations mean multiple firmware trains, and mixed firmware within a
single model is where the odd behaviour lives.

```bash
pdsh -w node[001-256] 'ibv_devinfo | grep -E "hca_id|fw_ver|board_id"' | dshbak -c
mlxfwmanager --query
flint -d /dev/mst/mt4123_pciconf0 q
```

Group by `board_id` — the PSID — not by model name. Within a PSID group, the
firmware version should be identical. Across PSID groups it will not be and
should not be expected to be. The check is uniformity within a group, and the
detail of doing the update is covered in the ConnectX firmware article in this
series.

Skew within a group is worth taking seriously because the symptoms are
generation-specific and unhelpful: a link that trains at a lower width with one
firmware and correctly with another, a counter that reads differently, a
congestion-control feature present on some cards and not others.

## Physical quality, which is different from link state

A link can be at full width and full rate and still be marginal. Forward error
correction hides a great deal, and it hides it right up until the offered load
is high enough that it cannot.

```bash
mlxlink -d mlx5_0 -p 1 -c --show_fec --show_eye --show_counters
```

The fields to compare across the fleet are raw BER, effective BER, and the FEC
histogram if the tool provides one for your device. A port whose raw BER is
orders of magnitude worse than its peers while its effective BER is clean is a
link that FEC is currently rescuing. It will pass every functional test. It is
also the one that will produce intermittent, load-correlated performance
problems that no configuration change fixes.

Comparing across the fleet is the essential part. A raw BER figure in isolation
is hard to judge; the same figure alongside sixty-three peers is obvious.

## Practical policy for a mixed estate

**Keep generations in separate scheduler partitions and separate topology
groups.** A job that straddles an NDR island and an EDR island runs at EDR, and
the user will not know why. Make the boundary explicit in the scheduler rather
than implicit in the fabric.

**Run the width and rate histogram on a schedule** and alert on any change to
the row counts. It is one command, it is cheap, and it converts the most
expensive class of quiet failure into a notification.

**Record intent alongside the fabric.** For every link that is deliberately at a
lower rate than the adapter supports, write down why. Otherwise every future
audit rediscovers it as an anomaly and someone eventually "fixes" it.

**Baseline `mlxlink` output per port** at install and compare periodically. It is
the only way to see a link degrading rather than a link failed.
