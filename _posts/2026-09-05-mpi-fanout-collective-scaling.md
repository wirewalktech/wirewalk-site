---
title: "Fan-out tests: what one-to-many finds that point-to-point cannot"
date: 2026-09-05 14:00:00 -0400
category: Benchmarking
tags: [MPI, Collectives, Routing, ISL, osu_mbw_mr]
summary: >-
  A single flow takes a single path, so a pair test is indifferent to almost
  everything that is wrong with a fabric. Fan-out puts many flows on it at once,
  and that is when static routing, ISL capacity and one slow node show up.
---

A point-to-point bandwidth test between two nodes exercises one path. Under
static routing — which is what InfiniBand does by default — that path is fixed
by the subnet manager's forwarding tables, and one flow on one path is
indifferent to how well or badly those tables distribute traffic overall. You
can have a routing engine that has collapsed eight parallel inter-switch links
onto three, and `osu_bw` between a well-chosen pair will report a perfect
number, every time, reproducibly.

That is the gap fan-out tests exist to close. The moment you put many
simultaneous flows on the fabric, path selection stops being a detail and
becomes the dominant term.

## The three shapes

**One-to-many.** One node sends to N others concurrently. This finds the sender's
own ceiling — its adapter, its PCIe slot, its memory bandwidth — and it finds
the first hop out of that node's leaf switch. It is the right test for a storage
node, a parameter server, or any rank-zero-heavy pattern.

**Many-to-one.** N nodes send to one. This is the incast pattern, and it is a
different test, not a mirror image. It is where switch buffering, flow control
and congestion control get exercised, and it is where a fabric that looks fine
under one-to-many falls apart.

**Many-to-many.** Every node to every node. This is what an alltoall does, and it
is the test that actually measures the fabric rather than any endpoint.

Run all three. A cluster that passes one-to-many and fails many-to-many has a
fabric problem. A cluster that fails all three at the same node has a node
problem. That distinction is available in about twenty minutes and is otherwise
the subject of a long argument.

## osu_mbw_mr, and why message rate is a separate ceiling

`osu_mbw_mr` is the multiple-bandwidth / message-rate test. It takes `2N` ranks,
makes the first `N` senders and the second `N` receivers, pairs them up, and
runs all pairs concurrently. It reports aggregate bandwidth and aggregate
message rate for each message size.

```bash
# 16 ranks per node, one node sending, one node receiving
mpirun -np 32 -map-by ppr:16:node --bind-to core \
  -x UCX_NET_DEVICES=mlx5_0:1 \
  ./osu_mbw_mr
```

Two things make it worth running that a pair test is not.

First, it is the only cheap way to find a **per-node ceiling that is below the
per-link rate**. A single pair of ranks frequently cannot saturate a modern
adapter — one rank, one queue pair, one core is not enough to fill NDR400. If
you conclude from a single-pair `osu_bw` that the link is at half rate, you may
simply be measuring one core. Increase the concurrency and the number moves. If
it does not move, the ceiling is real and it is in the node.

Second, the **message rate** column is a ceiling that bandwidth never reveals.
Adapters have a maximum packets-per-second they can process, and applications
with many small messages hit that ceiling while the bandwidth graph looks
comfortable. If the message rate flattens as you add pairs while bandwidth is
nowhere near the link rate, the constraint is packet processing, not bytes, and
no amount of fabric work changes it. The fixes live elsewhere: message
aggregation, larger buffers, or a different communication pattern.

Sweep the concurrency deliberately rather than accepting the default:

```bash
for ppn in 1 2 4 8 16 32; do
  echo "== ppn=$ppn"
  mpirun -np $((ppn*2)) -map-by ppr:${ppn}:node --bind-to core ./osu_mbw_mr
done
```

The shape of that sweep is the useful output. Bandwidth rises and plateaus;
where it plateaus is your real per-node number. Message rate rises and plateaus
somewhere else entirely.

## Where fan-out exposes the fabric

Here is the mechanism, because it is the part that is worth understanding rather
than memorising.

Under static routing, the subnet manager assigns each destination LID an output
port on every switch. Every flow to a given destination therefore leaves a given
switch through the same port, regardless of how busy that port is. On a
leaf-and-spine fabric with, say, eight uplinks from a leaf to the spine tier, the
routing engine distributes destination LIDs across those eight uplinks — and how
evenly it does that is the whole question.

With one flow, you use one uplink and it is fine. With sixty-four concurrent
flows, if the distribution assigned twenty of them to one uplink and two to
another, that first uplink is oversubscribed by a factor of ten and the other is
idle. The aggregate number you measure is set by the busiest uplink, not by the
total capacity.

This is not hypothetical and it is not rare. It is the normal consequence of a
routing engine that declined the topology and fell back to something simpler, of
a `updn` configuration with no root GUID list, or of a fabric whose leaf uplink
counts are not uniform. The article on OpenSM routing engines in this series
covers how to confirm which engine is actually running.

### Measuring the distribution directly

Do not infer it from bandwidth. Read the switch counters.

```bash
# baseline
ibclearerrors
for lid in $SPINE_LIDS; do
  perfquery -x $lid   # extended (64-bit) counters, all ports
done > /var/tmp/counters-before.txt

mpirun -np 512 -map-by ppr:8:node ./osu_alltoall -m 1048576:1048576

for lid in $SPINE_LIDS; do perfquery -x $lid; done > /var/tmp/counters-after.txt
```

`PortXmitData` is in 32-bit words on most implementations, so multiply by four
for bytes; what you care about is the ratio between uplinks, not the absolute
value. Take the delta per port and look at the spread. An engine distributing
well produces uplink deltas within a few percent of each other. An engine that
is not produces a spread you can see without a calculator, and that spread is
your missing bandwidth.

`PortXmitWait` on the same ports is the corroborating evidence. It counts ticks
during which the port had data queued and no credit to transmit. Large and
uneven `PortXmitWait` across parallel uplinks is congestion concentrated on a
subset of links, which is exactly the signature of a routing imbalance.

<div class="note" markdown="1">
Use the 64-bit extended counters (`perfquery -x`, or `perfquery -x -a`). The
legacy 32-bit `PortXmitData` counter wraps in seconds at modern link rates, and
a wrapped counter produces a delta that is not merely wrong but arbitrarily
wrong — sometimes negative, sometimes plausible. This has cost people real
conclusions.
</div>

## Reading the knee

Fan-out results are curves, and the useful information is in where the curve
bends rather than in any single point.

Run the same collective at a fixed message size across a doubling sequence of
node counts, holding ranks-per-node constant:

```bash
for n in 2 4 8 16 32 64; do
  srun -N $n --ntasks-per-node=8 ./osu_allreduce -m 4194304:4194304
done
```

For **allreduce**, the expected shape depends on the algorithm. NCCL-style and
MPI ring implementations move `2(n-1)/n` of the buffer per rank, which
approaches a constant as `n` grows, so time at a large fixed message size should
flatten out rather than grow. Tree and recursive-doubling implementations trade
that for a latency term that grows as `log(n)`, which dominates at small message
sizes. So: at large messages you expect a plateau, at small messages you expect
a gentle logarithmic rise. Anything that rises **linearly** with node count is
not the algorithm — it is the fabric or a straggler.

For **alltoall**, every rank sends to every other rank, so the total bytes
crossing the fabric grows as `n²` while the bisection capacity of a
non-blocking fat tree grows as `n`. On a genuinely non-blocking fabric, per-rank
alltoall time at a fixed per-peer message size should stay roughly flat. The
node count where it stops being flat is a measurement of where your fabric stops
being non-blocking, and that is a genuinely useful number to own.

Three distinct knee shapes and what each means:

| Shape | Reading |
|---|---|
| Flat, then a step at a specific node count | You crossed a topology boundary — filled a leaf, started using spine uplinks, or crossed into a second island |
| Flat, then a smooth linear rise | Oversubscription. The fabric's aggregate capacity is now the limit |
| Noisy from the start, no clean curve | Not a scaling result at all. Something is varying between runs — go find it before drawing any curve |

That third row is the common one and it is worth taking seriously. If you cannot
reproduce a point to within a few percent across three runs, you do not yet have
a measurement, and fitting a curve through it produces a confident wrong
conclusion.

## Controlling for allocation

A scaling curve is only comparable if the node set is comparable. Two runs at 32
nodes that land on different parts of the fabric are two different experiments.

Pin the placement and record it:

```bash
srun -N 32 --ntasks-per-node=8 --nodelist=$(cat nodes.32) ./osu_alltoall
scontrol show hostnames $SLURM_JOB_NODELIST > run-$(date +%s).nodes
```

If your scheduler has topology awareness configured, use it — `--switches=1`
asks Slurm for an allocation within a single switch, and the difference between
a within-leaf run and a cross-spine run at the same node count is itself a
measurement worth taking.

And record the node list with every result. The single most common reason a
benchmark "regressed" is that it ran somewhere else.

## The one-slow-node problem

A collective completes when its slowest participant completes. That makes
fan-out tests exquisitely sensitive to a single degraded node — which is
useful, and also dangerous, because the symptom presents as a fabric-wide
problem.

The signature: results that vary run to run in a way that correlates with the
allocation rather than with anything you changed. Some 32-node runs are fine and
some are 30 percent down, and which is which tracks whether a particular node
was included.

The bisection method finds it quickly. Split the node set in half, run both
halves, keep the slow half, repeat. Six rounds covers 64 nodes. It is crude and
it is faster than reasoning about it.

The systematic alternative is a pairwise sweep — every node against a fixed
reference node, using `ib_write_bw` rather than MPI so you are testing one layer
at a time:

```bash
for n in $(scontrol show hostnames $SLURM_JOB_NODELIST); do
  ssh $n "ib_write_bw -d mlx5_0 -F -s 1048576 -D 5 --report_gbits $REF" \
    | awk -v n=$n '/1048576/ {print n, $4}'
done | sort -k2 -n | head
```

The bottom of that sorted list is your answer, and it is usually one node with a
narrow link, a downtrained slot, or a transceiver on its way out. It is worth
running this on a schedule rather than during an incident: a node that
degrades quietly poisons every synchronised job it touches, and the cost of
finding out late is measured in withdrawn results, not in wasted cycles.

## What to keep

Per fabric, keep: the `osu_mbw_mr` bandwidth and message-rate plateaus with the
concurrency at which each was reached; the alltoall and allreduce curves across
your real node-count range with the node lists attached; and the per-uplink
counter deltas from one representative alltoall.

The counter deltas are the item people omit and the one that ages best. Bandwidth
numbers move when hardware changes. A routing distribution that was even in
January and is lopsided in June is a change in the fabric, and having the
January baseline is the difference between knowing that and arguing about it.
