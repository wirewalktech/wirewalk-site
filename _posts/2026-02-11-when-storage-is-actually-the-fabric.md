---
title: "When a storage read ceiling is really an InfiniBand routing problem"
date: 2026-02-11 10:00:00 -0500
category: Fabric
tags: [InfiniBand, Routing, Storage, perfquery, OpenSM]
summary: >-
  How to tell a parallel filesystem read ceiling apart from a static-routing
  collapse on the inter-switch links, using per-ISL counter deltas and a
  network-only corroboration test. Includes the elimination order and the one
  command that would have answered it on the first morning.
---

There is a symptom shape that sends people looking in the wrong layer for a week.
A parallel filesystem writes close to the number the design predicted and reads
at roughly half that. Nothing is saturated. Client adapters sit well below half
their line rate, the storage servers are not CPU-bound, the disks are not busy,
and fabric monitoring shows aggregate utilization in the twenties. Every component
reports headroom and the aggregate refuses to move. On the storage servers,
during the read phase that is supposedly the problem:

```
$ iostat -x 5 | grep -E 'Device|nvme0n1'   # write-side columns trimmed
Device   r/s     rkB/s   rrqm/s  %rrqm r_await rareq-sz  aqu-sz  %util
nvme0n1  812.4  830617.6    0.0   0.00    0.41   1022.6    0.33  31.20
```

Thirty-one percent device utilization and sub-millisecond read latency, with a
queue that never gets deeper than a third of one outstanding request. The disks
are not the constraint.

The reflex is to call it a storage problem, because the number you are unhappy
with came out of a storage benchmark. That reflex is usually wrong when the
asymmetry is this clean. Read and write paths share almost everything. The short
list of genuine differences is readahead, the disk-side read/write mix, and the
direction the bytes travel. Rule out the first two and the third is not an exotic
explanation, it is the only one left.

## Why the fabric is a plausible suspect at all

InfiniBand unicast routing, in the configuration almost everyone runs, is static
and destination-based. Each switch holds a linear forwarding table mapping a
destination LID to exactly one output port. Not a set of ports, not a hash over
flows — one port. Every packet addressed to that LID leaves through that cable
for as long as the table stands.

Where two switches are joined by several inter-switch links, the subnet manager
decides which link each destination uses. OpenSM's default engine is Min Hop,
and its balancing rule is in its own documentation: among ports offering the same
hop count, pick the one with fewer LIDs already assigned. That is round-robin
over destinations.

Read that rule again, because the whole article is in it. The engine balances the
**number of destination addresses** per output port. It has no idea which of
those addresses carry traffic, how much, or when. Two ports holding eight LIDs
each are equally loaded as far as the routing engine is concerned, even if all
the traffic in the cluster is addressed to three LIDs that happen to share one
port.

Apply that to a filesystem and the two directions stop being symmetric:

- **Writes** are addressed to the storage servers. Eight of them over eight
  inter-switch links, and round-robin over eight consecutive GUIDs puts one
  storage LID on each. The spread is perfect. That is not good engineering, it is
  small-*n* luck — reliable luck, which is why nobody notices.
- **Reads** are addressed to the clients, drawn from a much larger pool: every
  compute node in the subnet, not just the ones in this job. Where a given client
  lands in the global round-robin has nothing to do with whether it is running
  your job. If the spacing between your job's nodes in the routing order aliases
  against the number of links, groups of them share one cable and other cables
  carry nothing.

The aliasing is not hypothetical. OpenSM ships an option whose purpose is to
break it — `scatter_ports`, documented as randomizing port selection "rather than
using a round-robin algorithm (which is the default)". Options do not get written
for problems nobody has.

<div class="note" markdown="1">
I would not try to predict from first principles which links a given fabric
collapses onto. The alignment depends on GUID ordering, discovery order, how many
LIDs sit behind the same links, and whether the tables were computed before or
after the last cable was plugged in. Measure it; the measurement is cheap and the
prediction is not.
</div>

## Finding the inter-switch links

Before any counters, establish which physical ports are ISLs and confirm they run
at the width and rate you think. One link that came up at 1X instead of 4X
produces a similar-looking aggregate shortfall from a completely different cause,
and it is embarrassing to find in week two.

```
$ ibswitches
Switch  : 0x043f720300xxxxxx ports 40 "SwitchA" enhanced port 0 lid 1 lmc 0
Switch  : 0x043f720300yyyyyy ports 40 "SwitchB" enhanced port 0 lid 2 lmc 0
```

```
$ iblinkinfo -S 0x043f720300yyyyyy | grep -i switch
       2   25[  ] ==( 4X  53.125 Gbps Active/  LinkUp)==>  1   13[  ] "SwitchA"
       2   26[  ] ==( 4X  53.125 Gbps Active/  LinkUp)==>  1   14[  ] "SwitchA"
       2   27[  ] ==( 4X  53.125 Gbps Active/  LinkUp)==>  1   15[  ] "SwitchA"
       2   28[  ] ==( 4X  53.125 Gbps Active/  LinkUp)==>  1   16[  ] "SwitchA"
       2   29[  ] ==( 4X  53.125 Gbps Active/  LinkUp)==>  1   17[  ] "SwitchA"
       2   30[  ] ==( 4X  53.125 Gbps Active/  LinkUp)==>  1   18[  ] "SwitchA"
       2   31[  ] ==( 4X  53.125 Gbps Active/  LinkUp)==>  1   19[  ] "SwitchA"
       2   32[  ] ==( 4X  53.125 Gbps Active/  LinkUp)==>  1   20[  ] "SwitchA"
```

Eight links, all 4X, all at the same per-lane rate. `iblinkinfo` prints the
**per-lane** figure, not the link figure: 53.125 Gbps across four lanes is HDR, a
200 Gb/s link. Read that column as the link rate and you will invent a capacity
problem that does not exist.

The second trap is to take the encoding overhead off twice. HDR uses 64b/66b line
coding, but the 200 Gb/s that everyone quotes for 4X HDR is the IBTA *data* rate,
already net of that coding — the per-lane signalling rate is the 53.125 Gbps in
the column above. The same relationship holds one generation down, where EDR's
25.78125 Gbps per lane × 64/66 is exactly 25, and 4X EDR is exactly 100 Gb/s.
Dividing 200 by 66/64 a second time gets you 193.9 Gb/s and a ceiling that is 3%
too low for no reason.

So: 200 Gb/s is 25 GB/s, or 23.3 GiB/s, and that is the theoretical figure.
Subtract IB transport headers, ICRC and flow control and a healthy 4X HDR link
delivers around **22.6 GiB/s** of payload in practice, which is roughly what
`ib_write_bw` returns on an idle one. That 22.6 is the per-link ceiling used
throughout this article, and eight links give about 180.8 GiB/s each way. It is a
measured number rather than a derived one, so measure it on your own hardware
before you quote a percentage against it.

## Reading per-ISL counters

`perfquery` reads the performance management agent on a switch port. Query the
ISL ports on one switch and you get both directions from one place:
`PortXmitData` leaves that port toward the far switch, `PortRcvData` arrives from
it. On a switch at the storage side, reads are `PortXmitData` and writes are
`PortRcvData`. Use the extended counters; at these rates it is not optional:

```
$ perfquery -x 2 25
# Port extended counters: Lid 2 port 25
PortSelect:......................25
CounterSelect:...................0x0000
PortXmitData:....................347892350976
PortRcvData:.....................183609851904
PortXmitPkts:....................339741882
PortRcvPkts:.....................179309714
PortUnicastXmitPkts:.............339740115
PortUnicastRcvPkts:..............179307946
PortMulticastXmitPkts:...........1767
PortMulticastRcvPkts:............1768
```

Two things about those numbers before you divide anything by anything.

**The data counters are in units of four octets.** The IBA specification defines
`PortXmitData` and `PortRcvData` as the number of data octets divided by four,
summed over all virtual lanes. Multiply by 4 to get bytes. Forget this and you get a
number four times too small — comfortingly close to a quarter of link rate, and
exactly the kind of wrong answer that survives a sanity check.

**The basic 32-bit counters wrap in well under a second.** A 32-bit counter in
units of 4 octets tops out at 2^32 × 4 = 17.18 GB, or 16 GiB. On an HDR link
carrying 21.6 GiB/s that is 0.74 seconds; on NDR, half that. Sample the basic
counters over a 60-second window and you are measuring the remainder after eighty
wraps. The `-x` flag, and only that flag, gives the 64-bit versions. The extended
counter attribute is optional in the specification — a device advertises it in
the performance class `CapabilityMask` — but present on anything you are likely
to be buying.

One counter does not come along for the ride. `PortXmitWait`, which matters later,
lives in the basic `PortCounters` attribute and not in `PortCountersExtended`, so
`perfquery -x` will not show it. Read it with plain `perfquery`, and remember it
is 32 bits wide like everything else in that attribute.

## Sampling twice and differencing

Counters are cumulative. The measurement is a difference over a known interval
while a known workload runs. Do not reset them if anything else on the site reads
them; you will corrupt a monitoring baseline, and the delta method does not need
a reset.

```bash
#!/bin/bash
# per-ISL throughput, both directions, over a fixed window
SW_LID=2
PORTS="25 26 27 28 29 30 31 32"
WINDOW=60

sample() {
  for p in $PORTS; do
    perfquery -x "$SW_LID" "$p" \
      | awk -v p="$p" '
          /^PortXmitData:/ { gsub(/[^0-9]/,"",$0); x=$0 }
          /^PortRcvData:/  { gsub(/[^0-9]/,"",$0); r=$0 }
          END { print p, x, r }'
  done
}

sample > /tmp/isl.t0
sleep "$WINDOW"
sample > /tmp/isl.t1

join /tmp/isl.t0 /tmp/isl.t1 | awk -v w="$WINDOW" '
  { dx=($4-$2)*4; dr=($5-$3)*4;
    printf "port %-3s  xmit %7.2f GiB/s   rcv %7.2f GiB/s\n",
           $1, dx/w/1073741824, dr/w/1073741824 }'
```

The `gsub` is there because `perfquery` pads with dots rather than whitespace, so
the value is not in a predictable field. Parsing it as `$2` works on some
releases and silently returns zero on others.

Run it twice: once under a write-only workload, once under a read-only workload
over a dataset too large for client or server page cache. If the read set fits in
cache you measure memory, get a spectacular number and learn nothing.

## The table that ends the argument

A twelve-client run against eight storage servers, sampled over 60 seconds on the
storage-side switch. The left columns are measured; the right two come from the
forwarding table, which comes next.

| ISL port | Write run, GiB/s | Read run, GiB/s | Read-run link use | Active client LIDs routed here | Total LFT entries via this port |
|---|---|---|---|---|---|
| 25 | 11.2 | 21.6 | 96% | 6 | 9 |
| 26 | 11.6 | 21.3 | 94% | 5 | 8 |
| 27 | 11.4 | 7.4 | 33% | 1 | 9 |
| 28 | 11.3 | 0.0 | 0% | 0 | 8 |
| 29 | 11.5 | 0.0 | 0% | 0 | 9 |
| 30 | 11.4 | 0.0 | 0% | 0 | 8 |
| 31 | 11.2 | 0.0 | 0% | 0 | 9 |
| 32 | 11.8 | 0.0 | 0% | 0 | 8 |
| **Total** | **91.4** | **50.3** | **28% mean** | **12** | **68** |

Read the write column first. Eight links carrying 11.2 to 11.8 GiB/s, every one
at about half its 22.6 GiB/s ceiling. That is a healthy fabric, and it is why
nobody suspected the fabric: anyone who looked at ISL utilization during a write
test saw 50% and moved on.

Now the read column. Five of eight cables carry nothing. Two carry 21.6 and 21.3
GiB/s, which is 96% and 94% of what an HDR link delivers as payload. Those two
are full. The mean across all eight is 28%, and 28% is what an aggregate fabric
graph shows, which is why an aggregate fabric graph cannot find this. The unit of
scarcity is a cable, and averaging over cables destroys the information you
need.

### The row that makes it certain

Port 27 is the most useful row in the table. One client is routed over it, and it
reads at 7.4 GiB/s. In the write run twelve clients moved 91.4 GiB/s, or 7.62
GiB/s each. A client with an uncontended path therefore reads within 3% of what
it writes. There is nothing wrong with readahead, prefetch, the disks, the
servers or the client: a client that gets its own cable performs as designed.

That row turns "the fabric is suspicious" into "the fabric is the constraint",
and it lets you predict the aggregate rather than merely describe it. Build the
prediction only from quantities that did not come out of the read run itself,
or you are adding up the answer and calling it a forecast. Two of them qualify:
the per-link payload ceiling, established on idle hardware, and the per-client
rate from the write run.

```
two ISLs at payload ceiling    2 × 22.6 = 45.2 GiB/s
one uncontended client (write-run rate) =  7.6 GiB/s
                              predicted   52.8 GiB/s
                               measured   50.3 GiB/s   (-4.8%)
```

Within 5%, from two numbers neither of which was measured during the read test,
with the shortfall in the direction you would expect — a shared link running a
little under its idle ceiling. That is a different class of evidence from a
plausible story. Adding the measured read column to 50.3 is arithmetic, not a
prediction, and it is worth keeping the two apart when someone challenges the
result.

## The obvious interpretation, and why it is wrong

Everyone seeing that table for the first time says the same thing: five cables
are dead, so five cables are broken, check the transceivers.

They are not broken. Look one column left. In the write run those same five
cables carried 11.2 to 11.8 GiB/s each, indistinguishable from the two that
saturate on reads. The link is up, at 4X, at the right rate, with no errors:

```
$ ibqueryerrors -c
## Summary: 22 nodes checked, 56 ports checked, 0 ports have errors beyond threshold
```

`ibqueryerrors` with no target sweeps the fabric and prints only the ports that
have something wrong, which is the behavior you want here. Two of its flags read
backwards from the obvious guess, and both will cost you: `-s` takes a list of
counters to **suppress**, not to select, so naming the counters you care about is
the one way to guarantee you do not see them. And `-k` / `-K` clear error and data
counters as they read — run those on a production fabric and you have silently
reset the baseline of whatever else monitors it, which is the same mistake the
counter-differencing section warns against. `-c`, used above, suppresses the
common side-effect counters and clears nothing.

A cable carries nothing on reads because **no destination LID with read traffic
is mapped to it**, and a full share on writes because storage LIDs are. Same
cable, same hour, two different pictures depending on which way the bytes go.

The second wrong interpretation is subtler and costs more. "No link is saturated,
therefore the fabric is not the bottleneck." Sound when links are used uniformly;
useless here, because the reported statistic uses a denominator that includes
five cables the traffic cannot reach. The correct denominator is the capacity the
routing tables permit: 3 × 22.6 = 67.8 GiB/s, of which the run achieves 50.3.
Seventy-four percent of a hard ceiling with two of three links at 95% is a
saturated network.

## Corroboration without a disk in the path

You now have a fabric-shaped explanation built entirely from fabric counters.
Before acting on it, prove the ceiling exists with the filesystem out of the
picture. If a pure RDMA test between the same endpoints, in the same direction,
with no block device in the path, lands near the filesystem's number, the
bottleneck is at or below the network and no storage tuning will move it.

Run RDMA writes *from* the storage nodes *to* the clients, so bytes travel in the
read direction. Start all pairs together; one pair at a time tells you nothing
about aggregate behavior.

```bash
# on each client (receiver), one server process per pair
ib_write_bw -d mlx5_0 -F -q 4 -s 1048576 -D 30 --report_gbits -p 18515 &

# on each storage node (sender), one process per assigned client, with -p
# matching that client's listener. Twelve pairs over eight senders means some
# nodes run two; give each pair its own port or the second will fail to bind.
ib_write_bw -d mlx5_0 -F -q 4 -s 1048576 -D 30 --report_gbits -p 18515 <client-ip>
```

```
 #bytes  #iterations   BW peak[Gb/sec]  BW average[Gb/sec]  MsgRate[Mpps]
 1048576    112367        32.10              31.42             0.003746
 1048576    112116        31.88              31.35             0.003737
 1048576    133324        38.04              37.28             0.004444
 ...
 1048576    227273        64.02              63.55             0.007576
```

Twelve pairs, summed: **51.0 GiB/s**. The filesystem read run gave 50.3 GiB/s.
The gap is 1.5%, and there is no disk, no metadata server, no page cache and no
filesystem client in the RDMA path.

The per-pair spread corroborates the routing story more sharply than the total
does. The pairs fall into three groups rather than scattering: six at about 31.4
Gb/s, five at about 37.3 Gb/s, and one at 63.6 Gb/s. Those are the ISL ceilings
divided by the number of pairs sharing them — 21.6 GiB/s split six ways, 21.3
GiB/s split five ways, and port 27's single client taking the cable to itself at
about 7.4 GiB/s. The grouping matches the `ibroute` counts exactly, in a tool that
knows nothing about the filesystem and was never told which clients share a cable.

The `MsgRate` column is a free consistency check on the whole block, and worth
using. At 31.42 Gb/s with 1 MiB messages the rate is about 3,750 messages per
second, which perftest reports in Mpps as 0.00375. A message rate of several whole
Mpps next to a megabyte message size is arithmetically impossible — it would be
terabits — and seeing one means the run used a different `-s` than you think, or
the figure was pasted from somewhere without being read.

<div class="note" markdown="1">
This test is only corroboration if the pairing is the same. If you let the test
pick a different set of nodes, or a different number of them, you have changed
which LIDs are destinations and therefore which cables carry the traffic. A
network-only test on a different node list can easily come out fast and send you
back to the storage layer for another week.
</div>

## The one command that would have short-circuited all of it

Everything above reconstructs something the switch will simply tell you.
`ibroute` dumps a switch's linear forwarding table: destination LID on the left,
output port on the right.

```
$ ibroute 2 | head -10
Unicast lids [0x0-0x2f] of switch Lid 2 guid 0x043f720300yyyyyy (SwitchB):
  Lid  Out   Destination
       Port     Info
0x0001 025 : (Switch portguid 0x043f720300xxxxxx: 'SwitchA')
0x0003 025 : (Channel Adapter portguid 0x...: 'client-a HCA-1')
0x0004 026 : (Channel Adapter portguid 0x...: 'client-b HCA-1')
0x0005 025 : (Channel Adapter portguid 0x...: 'client-c HCA-1')
0x0006 026 : (Channel Adapter portguid 0x...: 'client-d HCA-1')
0x0007 025 : (Channel Adapter portguid 0x...: 'client-e HCA-1')
0x0008 026 : (Channel Adapter portguid 0x...: 'client-f HCA-1')
```

Count how many of your job's LIDs land on each output port:

```bash
# $JOB_LIDS = path to a file holding the LIDs of the clients in the run,
# one per line, in the same 0x%04x form ibroute prints (0x0003, not 3).
$ ibroute -n 2 \
    | awk 'NR==FNR {want[$1]; next}
           FNR>3 && ($1 in want) {c[$2]++}
           END {for (p in c) printf "port %s: %d\n", p, c[p]}' "$JOB_LIDS" - \
    | sort
port 025: 6
port 026: 5
port 027: 1
```

Match the LIDs as whole fields, not as substrings. An earlier version of this
used `grep -Ff` against the LID list with `^` prefixed to each line, which does
nothing useful: `-F` makes the `^` a literal character to search for, so the
pattern matches no line at all and the pipeline reports an empty distribution —
a result indistinguishable, at a glance, from a fabric with no job traffic on it.
The `awk` form above compares field 1 for equality and has no such failure mode.

Twelve clients, three of eight available cables, two of them holding eleven of
the twelve. That is the answer. It takes about four seconds and needs no
benchmark, no maintenance window and no counter arithmetic.

The reason it is not the first thing anyone tries is structural. Parallel
filesystem tuning documentation is thorough about page pool sizing, block size,
prefetch depth and queue depths, and says essentially nothing about inter-switch
links or routing engines, because those belong to another vendor's product and
another team's runbook. A filesystem-shaped investigation follows a
filesystem-shaped checklist, and that checklist has no entry for "count how many
of your nodes are routed over the same cable". The elimination order below exists
to add one.

## Telling this apart from the things it resembles

| Symptom shape | Likely cause | Command that distinguishes | What you see if it is this |
|---|---|---|---|
| Both directions slow, ISLs even and well below ceiling | Not the fabric. Storage or client concurrency. | `iostat -x 5` on servers; rerun with 2× the clients | Device utilization high, or throughput scales with client count |
| One direction slow, several ISLs at exactly zero | Static routing collapse | `ibroute <sw-lid>` | Active destination LIDs concentrated on a few output ports |
| One direction slow, all ISLs loaded, all near ceiling | Genuinely out of ISL bandwidth | the perfquery table | Aggregate ≈ number of ISLs × per-link payload ceiling |
| Slow and erratic, ISLs uneven but none at zero | A degraded link | `iblinkinfo \| grep -v "4X.*53.125"` | One link at 1X, or negotiated to a lower rate |
| Slow, `PortXmitWait` climbing, no link near ceiling | Credit starvation from a slow receiver downstream | plain `perfquery <lid> <port>` deltas on `PortXmitWait` (not in the `-x` set) | XmitWait rising on the ports that feed one endpoint |
| Slow with rising error counters | Physical: cable, connector, transceiver | `ibqueryerrors -c`, twice, differenced | Non-zero deltas isolated to specific cables |
| Slow for some jobs and not others | Allocation-dependent LID mapping | rerun on a different node list | The ISL distribution changes with the node list |

The last row causes the most confusion on a shared cluster. Once the mechanism is
clear it follows that the throughput a user gets depends on which nodes the
scheduler handed them, and that two runs of an identical job on identical
hardware can differ by a factor of two with nothing wrong anywhere. A benchmark
result quoted without its node list is not reproducible, and a regression that
comes and goes between runs may be the scheduler rather than the storage.

`PortXmitWait` deserves a note. It counts ticks during which a port had data to
send and no credits to send it with, which makes it the best early indicator of
downstream congestion and also famously noisy. Difference it like the data
counters — but with plain `perfquery`, since it is a basic 32-bit counter and the
`-x` attribute does not carry it:

```
$ perfquery 2 25 | grep PortXmitWait
PortXmitWait:....................18446231
```

Non-zero XmitWait is normal on a busy fabric. Only the rate of change, on
specific ports, correlated with a specific workload, means anything. Do not raise
a ticket on an absolute value. The tick is a device-specific unit rather than a
fixed interval, so treat the counter as an ordering between ports on the same
switch and not as a duration you can convert to seconds.

## The elimination order

| # | Step | Command | Cost | Rules out |
|---|---|---|---|---|
| 1 | Confirm every ISL is at full width and rate | `iblinkinfo -S <switch-guid>` | seconds | A degraded cable masquerading as a capacity shortfall |
| 2 | Count active job LIDs per ISL output port | `ibroute -n <sw-lid>` | seconds | Static routing collapse — or confirms it outright |
| 3 | Difference per-ISL counters under a write load | `perfquery -x`, two samples | 2 minutes | Establishes the healthy-direction baseline |
| 4 | Repeat under an uncached read load | same | 2 minutes | Produces the asymmetry table |
| 5 | Reproduce the ceiling with RDMA only, same pairing | `ib_write_bw` fan | 10 minutes | Everything above the network: filesystem, cache, disk |
| 6 | Check error and wait counters over the same window | `ibqueryerrors`, `PortXmitWait` deltas | minutes | Physical faults and downstream credit starvation |
| 7 | Only now, touch a filesystem tunable | — | hours to days | — |

Steps 1 and 2 take under a minute and answer the question on most fabrics.
Everything after them builds a case you can hand to someone else, which matters,
because the remedy usually needs a change to a subnet manager another team owns.

## What you can actually do about it

**Adaptive routing.** The real fix is to stop choosing the output port once per
destination and choose it per packet based on port load. On NVIDIA switches this
comes from the subnet manager, by selecting an AR-capable routing engine — the
`ar_*` family, such as `ar_updn`, alongside further `ar_` options that control the
mode and which service levels participate:

```
# opensm.conf — illustrative; take the exact directives from your own man page
routing_engine ar_updn
```

Three caveats, and the third is the one that bites. These engines are NVIDIA
extensions shipped with their subnet manager rather than upstream OpenSM, so
whether you have them at all depends on which SM package you installed. Adaptive
routing can also deliver packets out of order, which reliable-connected queue
pairs do not enjoy, so the SM generally restricts it to adapters advertising
tolerance for it. And the option names, defaults and permitted values in this
family have moved between MLNX_OFED and DOCA-OFED releases — read them out of the
`opensm` man page and sample `opensm.conf` shipped with the package you actually
have, not out of an article, this one included.

Then verify it took rather than assuming. NVIDIA's `smparquery` reads the
vendor-specific adaptive-routing MADs from a switch, and `ibdiagnet` reports AR
state in its fabric summary; check invocation syntax against your installed
version, as it differs between tool generations.

**More links to spread over.** Adding ISLs raises the ceiling without fixing the
mechanism. The distribution improves with the number of cables, but only up to
the number of active destinations, and only if the aliasing does not follow you.
The collapse can reappear at the next SM sweep with a different node allocation.

**Break the round-robin.** `scatter_ports` takes a seed and randomizes selection
among equally loaded ports instead of cycling. One line, no hardware implication,
attacks the aliasing directly — and it is a lottery, not a guarantee: you swap a
systematically bad distribution for a randomly chosen one, usually much better
and occasionally not.

**Route the important nodes first.** `guid_routing_order_file` sets the order in
which port GUIDs are routed for Min Hop and Up/Down. Put the genuinely hot GUIDs
at the top and they take the clean round-robin before the rest of the subnet
consumes the balance. Targeted, deterministic and underused.

**Change the engine.** On a genuine fat tree with all channel adapters at the
leaves, `ftree` routes with the topology in mind rather than counting LIDs. It
falls back rather than running on a topology it does not recognize, which is a
feature. Note that `ftree` does not support LMC greater than zero, and several of
the other engines carry restrictions of their own on LMC and on topology; check
the constraints for the specific engine and OpenSM version before planning
around one.

**Raise LMC, carefully.** Giving each port 2^LMC LIDs lets the engine compute
different paths to the same port. It helps only if the upper-layer protocol
issues path records for the alternate LIDs, which many do not, and the cost
multiplies across every port in the subnet and every forwarding table entry
needed to reach them. Establish that your client uses multiple paths first.

**Check who runs the subnet manager.** Where the SM runs on a managed switch, the
embedded manager exposes only a subset of these options through the switch CLI,
and on some firmware levels routing engine selection is not in it. Moving the SM
to a host gives the full option set and a config file you can version. Find out
what you have before planning around it:

```
$ sminfo
sminfo: sm lid 1 sm guid 0x043f720300xxxxxx, activity count 74412 priority 14 state 3 SMINFO_MASTER
```

`sminfo` reports the SM's *port* GUID, which for a switch's management port is
normally the same value `ibswitches` prints as the node GUID. A match there means
the fabric is being managed from the switch rather than from a host.

## What to claim afterwards

Be careful about the size of the claim. The evidence supports this: for this node
allocation, in the read direction, the achievable aggregate is bounded by three
inter-switch links, two of them at 95% of payload ceiling, and a network-only
test with no storage in the path reproduces the bound to within 2%. Narrow,
strong, checkable.

It does not support "the storage is fine". The storage was never tested above
50.3 GiB/s on reads because the network would not deliver more. When the routing
is fixed, expect a second ceiling behind the first. That is the ordinary shape of
performance work.

It also does not support a general statement about the fabric. Change the node
list and the numbers change. Quote any figure with the node count, the direction,
the dataset size relative to cache, and the ISL distribution that produced it.
Without those four the number is not reproducible, and someone will eventually
try to reproduce it.
