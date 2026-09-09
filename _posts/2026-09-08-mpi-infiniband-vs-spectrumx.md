---
title: "MPI on InfiniBand and on Spectrum-X: what transfers and what does not"
date: 2026-09-08 14:00:00 -0400
category: Fabric
tags: [RoCE, Spectrum-X, InfiniBand, PFC, ECN, DCQCN]
summary: >-
  The MPI layer looks identical on both. Everything underneath it is different,
  and on the Ethernet side a single hop configured wrongly degrades collectives
  across the entire fabric while every link reports healthy.
---

Running MPI over an Ethernet fabric with RoCEv2 and running it over InfiniBand
look the same from the application. Same verbs API, same UCX, same Open MPI,
same OSU benchmarks, same `ib_write_bw`. The adapter presents an
`/sys/class/infiniband/` device either way, which is why so much tooling appears
to be portable.

What is not portable is everything that makes the fabric lossless, and that is
where the operational differences live. On InfiniBand, link-level flow control
is built into the architecture and is on by default. On Ethernet it is a
configuration you have to get right on every port of every switch and every NIC
in the path, and getting it wrong on one hop degrades the whole fabric.

## The concept mapping

| InfiniBand | Ethernet / RoCEv2 |
|---|---|
| Subnet manager assigns LIDs and computes routes | No SM. L3 routing, BGP/ECMP, ARP and neighbour discovery |
| Credit-based link flow control, always on | PFC (802.1Qbb) per priority, configured per port |
| Congestion control notification (CCT/CCTI), rarely enabled | ECN marking plus CNP, and DCQCN on the NIC — normally mandatory |
| `ibstat`, `iblinkinfo`, `ibdiagnet`, `perfquery` | `ethtool -S`, `mlnx_qos`, `lldpctl`, switch telemetry |
| Path MTU 256–4096, negotiated | RoCE MTU derived from the L2 MTU; jumbo frames needed for 4096 |
| Static routing by default; adaptive routing a switch feature | ECMP by flow hash; Spectrum-X adds per-packet adaptive routing |
| Fabric is a single administrative object | Fabric is an IP network, with everything that implies |

Everything in the left column that you know how to use has an equivalent in the
right column that behaves differently enough to catch you out.

## What Spectrum-X changes about the Ethernet side

Plain RoCEv2 on general-purpose Ethernet is workable and fragile. The fragility
comes from two places: PFC is a blunt instrument that spreads congestion
backwards through the fabric, and ECMP hashes flows onto links, so a small
number of large elephant flows — which is exactly what a collective produces —
can collide on one link while others sit idle.

Spectrum-X addresses both. The switch performs adaptive routing at packet
granularity rather than flow granularity, spreading a single flow's packets
across available paths, and the NIC handles the resulting out-of-order arrival
and places data correctly without the sender having to care. Congestion control
is done in coordination between switch telemetry and the NIC rather than by the
generic DCQCN loop alone.

The practical consequence for MPI is that the ECMP collision problem — the one
that makes plain RoCE alltoall performance erratic — is substantially addressed
by the platform rather than by your hashing configuration. The PFC and ECN
configuration discipline does not go away.

Treat the specific feature names and defaults for your switch OS release as
authoritative over anything written here. What is stable is the shape of the
problem, not the syntax.

## PFC, and why one hop matters

Priority Flow Control sends a PAUSE frame for a specific traffic class when a
port's ingress buffer for that class fills. It is hop-by-hop: the upstream
device stops sending that class until the pause expires or is cancelled.

Two properties make it treacherous.

**It is per-priority, and the priority has to match end to end.** The NIC marks
RoCE traffic with a DSCP value or a PCP value; the switch maps that to a traffic
class; PFC is enabled on that class. Break the chain at any point — one switch
that trusts PCP where the NIC is marking DSCP, one port where PFC was never
enabled on priority 3, one uplink that was added later from a different template
— and RoCE traffic on that hop lands in a lossy class. It then drops under
congestion.

**A drop is far more expensive than it looks.** RoCE's reliable connection
transport recovers from loss, but recovery costs a round trip and, on older
implementations, a retransmission of everything after the lost packet. A drop
rate that would be invisible to TCP is enough to flatten collective performance.

And because a collective completes when its slowest participant completes, a
single misconfigured hop that affects a handful of flows degrades the whole job.
This is the mechanism behind the most confusing class of RoCE incident: every
link is up, no interface shows errors, throughput between any two nodes you test
is fine, and the alltoall is half what it should be.

### Checking the chain

On the NIC:

```bash
mlnx_qos -i enp1s0f0
```

```
DCBX mode: OS controlled
Priority trust state: dscp
Cable len: 7
PFC configuration:
	priority    0   1   2   3   4   5   6   7
	enabled     0   0   0   1   0   0   0   0
```

Two lines matter. `Priority trust state` must agree with what the switch is
trusting. `PFC configuration` must have the RoCE priority enabled and must agree
with the switch's per-port configuration.

Set it explicitly rather than inheriting:

```bash
mlnx_qos -i enp1s0f0 --trust dscp
mlnx_qos -i enp1s0f0 --pfc 0,0,0,1,0,0,0,0
```

Confirm what the RoCE traffic is actually marked with:

```bash
cat /sys/class/net/enp1s0f0/ecn/roce_np/cnp_dscp
cma_roce_tos -d mlx5_0
```

Then read the pause counters after a run. These are the evidence that PFC is
being exercised, and whether it is being exercised on the priority you intended:

```bash
ethtool -S enp1s0f0 | grep -E 'prio[0-7]_(pause|buf_discard)'
```

```
rx_prio3_pause: 148213
rx_prio3_pause_duration: 3320119
tx_prio3_pause: 96204
tx_prio3_pause_duration: 1904772
rx_prio0_buf_discard: 0
rx_prio3_buf_discard: 0
```

Read it as follows. Pause counts on priority 3 that are non-zero and growing
mean PFC is active and congestion is real — that is the mechanism working, not a
fault, though sustained heavy pausing means the fabric is oversubscribed for the
offered load. A non-zero `buf_discard` on the RoCE priority means packets were
dropped in a class that was supposed to be lossless, which is a configuration
failure. And pause counters on priority 0 while RoCE was running means your
traffic is not in the class you think it is.

<div class="note" markdown="1">
The counter that most often reveals the problem is `rx_prio0_pause` being
non-zero on a fabric that was configured for RoCE on priority 3. It means the
marking or the trust mode is wrong somewhere, and the traffic is being pause-
controlled — or not — in the default class. Every link is up, nothing logs an
error, and the collectives are poor.
</div>

## ECN and DCQCN

PFC stops congestion at the cost of pushing it upstream. ECN is the mechanism
that instead tells the sender to slow down, and it is what you want doing most of
the work, with PFC as the last resort that prevents loss.

The loop: the switch marks packets ECN-CE when its queue exceeds a threshold; the
receiving NIC sees the mark and returns a Congestion Notification Packet; the
sending NIC reduces its rate for that queue pair and then recovers according to
the DCQCN parameters.

The switch side is a WRED-style configuration with a minimum threshold, a
maximum threshold and a marking probability, per queue. Those numbers are the
main tuning lever and they interact with buffer size, link rate and round-trip
time, so they are genuinely site-specific — a setting tuned for a two-tier
100 GbE fabric is not right for a 400 GbE one.

The NIC side lives in sysfs:

```bash
ls /sys/class/net/enp1s0f0/ecn/roce_np/    # notification point (receiver)
ls /sys/class/net/enp1s0f0/ecn/roce_rp/    # reaction point (sender)

cat /sys/class/net/enp1s0f0/ecn/roce_np/enable/3
cat /sys/class/net/enp1s0f0/ecn/roce_rp/enable/3
```

Both must be enabled on the RoCE priority, on every node. A node with the
reaction point disabled does not slow down when told to, which means it wins
against its better-behaved neighbours and drives the fabric into PFC. One such
node in a large allocation is enough to make the whole job's timing erratic, and
it is a difficult thing to suspect if you are not looking for it.

The counters that show the loop working:

```bash
ethtool -S enp1s0f0 | grep -E 'cnp|ecn'
```

```
np_ecn_marked_roce_packets: 41229
np_cnp_sent: 40871
rp_cnp_handled: 39655
rp_cnp_ignored: 0
```

`np_ecn_marked_roce_packets` rising means the switch is marking, so ECN is
configured on the switch and the path. `np_cnp_sent` should track it closely.
`rp_cnp_handled` rising on the senders means they are reacting. `rp_cnp_ignored`
being non-zero means CNPs are arriving for queue pairs that no longer exist or
in a state where they cannot be acted on, and a large value is worth
investigating.

The failure signature to recognise: marking is happening, CNPs are being sent,
and `rp_cnp_handled` is zero or near it. The sending side is not reacting — the
reaction point is disabled, or the CNPs are being lost or misclassified on the
return path. CNPs themselves are typically marked with a different DSCP and
should be in a high-priority, non-paused class; if they are queued behind the
congestion they are meant to relieve, the control loop does not close.

There are also hardware counters on the RDMA device side, which are per-device
rather than per-netdev and sometimes easier to correlate with a specific job:

```bash
grep . /sys/class/infiniband/mlx5_0/ports/1/hw_counters/* | \
  grep -E 'out_of_buffer|out_of_sequence|packet_seq_err|local_ack_timeout_err|rnr_nak|np_cnp|rp_cnp|roce_adp_retrans'
```

`packet_seq_err` and `out_of_sequence` are the ones to watch. On a fabric that is
genuinely lossless they stay near zero. On Spectrum-X with packet-level adaptive
routing, out-of-order arrival is expected and handled, so interpret these against
the platform's own guidance rather than against an InfiniBand intuition.

## MTU

This is a small thing that costs a lot of bandwidth.

RoCE selects a path MTU from the standard set — 256, 512, 1024, 2048 or 4096
bytes — and it cannot exceed what the underlying Ethernet MTU can carry once
headers are accounted for. If any hop in the path is at the default 1500, the
RoCE MTU drops to 1024, and you lose a meaningful fraction of achievable
bandwidth to per-packet overhead and processing.

The requirement is jumbo frames configured consistently on every NIC and every
switch port in the path, typically 9000. One port left at 1500 — a newly added
uplink, a replaced switch, a host that did not get the configuration — is enough.

Confirm what was negotiated rather than what was configured:

```bash
ib_write_bw -d mlx5_0 -x 3 -F -a --report_gbits <server>   # header prints Mtu
ip link show enp1s0f0 | grep mtu
```

The `-x 3` selects a GID index, which on RoCE selects the RoCEv2 IPv4 or IPv6
entry. Get it from:

```bash
show_gids
```

Picking the wrong GID index is how people accidentally benchmark RoCEv1, or run
over link-local IPv6 when they meant to use the routed IPv4 address.

## What transfers between the two worlds

**Transfers cleanly:** the MPI layer entirely — Open MPI, MPICH, UCX, PMIx, the
OSU benchmarks, your application. `perftest` works on both with the addition of a
GID index. NCCL works on both, and refers to RoCE devices through the same
`NCCL_IB_HCA` variable, which confuses people into thinking they have InfiniBand.
The layered testing order from the first article in this series applies without
modification.

**Does not transfer:** `ibstat`, `iblinkinfo`, `ibdiagnet`, `ibnetdiscover`,
`perfquery`, `opensm` and everything built on LIDs and the subnet manager. There
is no routing engine to choose and no LID budget to compute. In their place you
have per-priority counters, switch telemetry, LLDP for topology discovery, and
whatever your switch vendor's fabric management provides.

**Transfers, but means something different:** latency figures. RoCE adds
UDP/IP encapsulation and the congestion-control loop, and end-to-end small-message
latency is generally higher than InfiniBand at an equivalent rate. How much
depends on the NIC generation and the switch, so measure it with `ib_send_lat`
on your own hardware rather than accepting a figure. The gap has narrowed
considerably across recent generations; it has not closed.

**Transfers, but with a different failure mode:** congestion. On InfiniBand,
credit-based flow control makes the fabric lossless without configuration, and a
congested fabric slows down. On Ethernet, an incorrectly configured fabric drops,
and RoCE recovery from drops is expensive enough that the performance cliff is
steep rather than gradual. That difference — gradual degradation versus a cliff —
is the single most important thing to internalise when moving MPI workloads from
one to the other.

## A minimum acceptance check on the Ethernet side

Before believing any MPI number on a RoCE fabric:

1. `mlnx_qos -i <dev>` on every node — trust mode and PFC priority identical
   everywhere.
2. `ecn/roce_np/enable/<prio>` and `ecn/roce_rp/enable/<prio>` set on every node.
3. MTU 9000 confirmed on every host interface and every switch port in the path,
   and RoCE MTU 4096 confirmed in the `ib_write_bw` header.
4. `show_gids` — the GID index in use is the RoCEv2 entry you intended.
5. Clear counters, run a full-scale alltoall, then check every node for
   `buf_discard` on the RoCE priority and `rp_cnp_handled` moving. Any discard on
   the lossless class is a stop-and-fix.

That takes half an hour and it is the difference between a fabric that performs
predictably and one that performs well on Tuesday.
