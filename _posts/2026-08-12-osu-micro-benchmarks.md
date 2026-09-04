---
title: "OSU Micro-Benchmarks: measuring the fabric before you blame the application"
date: 2026-08-12
category: Benchmarking
tags: [MPI, InfiniBand, RDMA]
summary: >-
  Point-to-point latency and bandwidth are the first numbers to establish on a
  new cluster, because every distributed result you collect afterwards is built
  on top of them.
---

When a distributed job runs slower than expected, the fabric is the first thing
accused and the last thing measured. The OSU Micro-Benchmarks exist to close
that gap. They are small MPI programs from the MVAPICH group at Ohio State that
measure one communication pattern at a time, with nothing else running.

The value is not the numbers themselves. It is that you take them once when the
machine is known good, write them down, and compare against them every time
something feels slow afterwards.

## The two that matter most

`osu_latency` sends a message between two ranks and reports half the round trip
time. `osu_bw` streams a window of messages in one direction and reports
sustained bandwidth. Everything else in the suite is a variation on those two
ideas.

```bash
# two ranks, one per node, pinned
mpirun -np 2 -map-by ppr:1:node --bind-to core \
  ./osu_latency
mpirun -np 2 -map-by ppr:1:node --bind-to core \
  ./osu_bw
```

Both sweep message sizes and print a table. Read them as two different regimes.
Small messages measure the fixed cost of getting a message onto the wire and
back off it: software stack, doorbell, interrupt or polling behavior, and the
switch hop count. Large messages measure how much of the link you can actually
fill. The interesting part is the middle, where the transport switches protocol.

## The eager to rendezvous transition

Below a threshold, MPI implementations send small messages eagerly: the sender
pushes the payload without waiting to hear that the receiver has somewhere to
put it. Above the threshold they switch to rendezvous, where the sender first
exchanges control messages and then the data moves by RDMA directly into the
destination buffer.

You can see the switch in the `osu_bw` table as a visible discontinuity in the
bandwidth curve. Knowing where it sits on your system is genuinely useful,
because an application whose typical message size lands just above the threshold
will behave very differently from one that lands just below. Both MPICH-derived
and Open MPI stacks let you move that threshold; whether you should is a
question to answer with measurements from your own application, not from a
micro-benchmark.

## Pinning changes the answer

An unpinned two-rank latency test measures the scheduler as much as the network.
If the process migrates to a core on the socket that does not own the HCA, every
message crosses the inter-socket link on the way to the wire.

Always pin, always place one rank per node for the point-to-point tests, and
check which NUMA domain your adapter is attached to:

```bash
cat /sys/class/infiniband/mlx5_0/device/numa_node
lstopo --output-format txt | head -40
```

If that returns a socket your ranks are not running on, fix the placement before
recording anything. This single mistake accounts for a large share of "the
network is slow" reports that turn out not to involve the network.

## Collectives, and why they are a different question

`osu_allreduce`, `osu_alltoall` and `osu_barrier` scale to the full job size and
are much closer to what real applications do. They are also much more sensitive
to noise. One slow node, one core running a stray daemon, one rank waiting on a
filesystem, and the whole collective inherits the delay, because a collective
finishes when its slowest participant finishes.

That sensitivity is the point. A collective benchmark that degrades while
point-to-point stays clean is telling you the problem is not the fabric. It is
jitter, and jitter comes from the operating system, the scheduler, thermal
behavior or a filesystem mount, not from the switch.

<div class="note" markdown="1">
Run the point-to-point tests between several different node pairs, not just the
first two the scheduler hands you. A single bad cable or a port that negotiated
a lower width will only show up when that specific link is on the path, and it
will look like an application problem for weeks.
</div>

## GPU buffers

Recent versions build CUDA-aware variants that take `-d cuda`, which places the
send and receive buffers in device memory instead of host memory:

```bash
mpirun -np 2 -map-by ppr:1:node ./osu_bw -d cuda D D
```

This is worth measuring separately, because the path is different. With
GPUDirect RDMA working, the adapter reads and writes device memory directly.
Without it, every message takes a detour through a host bounce buffer, and you
will see it immediately in the bandwidth number. Comparing `-d cuda` against the
host-memory run is the fastest way to confirm GPUDirect is actually engaged
rather than merely installed.

## What to record

Keep a file in version control with the date, the firmware and driver versions,
the MPI build, the node pair, and the resulting curves. It takes ten minutes and
it converts every future performance argument from opinion into a comparison.

The next articles in this series work up the stack from here: dense compute with
HPL, memory and network behavior with HPCG, mixed precision with HPL-MxP, and
collectives on GPU clusters with nccl-tests. All of them are easier to interpret
once you know what a single link on your machine can do.
