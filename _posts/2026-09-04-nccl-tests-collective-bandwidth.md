---
title: "nccl-tests: bus bandwidth, and the one column worth reading"
date: 2026-09-04
category: Benchmarking
tags: [NCCL, GPU, Collectives, GPUDirect]
summary: >-
  Two of the columns nccl-tests prints look like bandwidth. Only one of them is
  comparable across job sizes, and picking the wrong one is how a healthy
  cluster gets declared broken.
---

Distributed training spends a large share of its wall clock inside collective
operations. In data-parallel training the dominant one is an all-reduce over the
gradients, once per step, sized by the model. If that collective is slower than
the hardware allows, every step is slower, and no amount of framework tuning
recovers it.

`nccl-tests` from NVIDIA is how you measure that path on its own, with no model
and no framework in the way.

## Building it

Build against MPI if you intend to run across more than one node, which is the
only interesting case:

```bash
git clone https://github.com/NVIDIA/nccl-tests
cd nccl-tests
make MPI=1 MPI_HOME=/opt/openmpi CUDA_HOME=/usr/local/cuda
```

That produces one binary per collective: `all_reduce_perf`,
`all_gather_perf`, `reduce_scatter_perf`, `broadcast_perf`, `alltoall_perf`,
`sendrecv_perf` and a few others. Start with all-reduce, because it is what
training actually does.

```bash
mpirun -np 16 -map-by ppr:8:node \
  ./build/all_reduce_perf -b 8 -e 8G -f 2 -g 1 -w 5 -n 20
```

One rank per GPU, `-g 1`. The sweep runs from 8 bytes to 8 GB doubling each
step, with five warmup iterations discarded and twenty timed. Warmup is not
optional: the first call pays for buffer registration and connection setup, and
including it drags the small-message numbers into nonsense.

## The two bandwidth columns

The output has, for both out-of-place and in-place variants, a time, an
`algbw`, a `busbw` and a correctness count.

**`algbw`** is algorithm bandwidth. It is simply the message size divided by the
elapsed time. It answers "how fast did my data get processed," and it is the
number that looks intuitive.

**`busbw`** is bus bandwidth. It is `algbw` scaled by a factor that accounts for
how much traffic the collective genuinely has to move across the interconnect,
given the number of ranks. For a ring all-reduce, each byte has to traverse the
ring twice, once in the reduce-scatter phase and once in the all-gather phase,
and each rank ends up sending `(n-1)/n` of the buffer in each phase:

```
all-reduce         busbw = algbw × 2(n-1)/n
all-gather         busbw = algbw × (n-1)/n
reduce-scatter     busbw = algbw × (n-1)/n
all-to-all         busbw = algbw × (n-1)/n
broadcast, reduce  busbw = algbw
```

The consequence is the reason `busbw` exists. As you add ranks, `algbw` for a
fixed message size falls, because there is more work to do per byte. `busbw`
stays roughly flat, because it is measuring what the wire is doing. That makes
`busbw` comparable against your hardware's per-link capability and comparable
between a two-node run and a hundred-node run.

<div class="note" markdown="1">
Track `busbw`. Someone reporting that all-reduce "got slower when we scaled up"
is almost always reading `algbw`, where a decline is arithmetic rather than a
fault. Compare `busbw` at the same message size across job sizes; if that holds,
the fabric is behaving.
</div>

## Reading the sweep

The curve has two regimes and the transition tells you where your model sits.

At **small sizes** the result is latency-bound. Time is nearly flat as size
increases, so bandwidth rises roughly linearly. What you are measuring is the
fixed cost of a collective: kernel launch, synchronization, and the depth of the
communication pattern. NCCL uses tree algorithms here specifically because tree
latency grows logarithmically with rank count while ring latency grows linearly.

At **large sizes** the result is bandwidth-bound and `busbw` flattens into a
plateau. That plateau is the number to record and to compare against what the
links should deliver.

Work out where your gradient all-reduce lands. For a bucketed data-parallel
setup, the bucket size is the message size, and it is frequently in the region
where neither regime dominates cleanly. Moving the bucket size is a real tuning
knob, and this sweep tells you which direction to move it.

## When the plateau is too low

The plateau being well below what the hardware should do almost always comes
down to one of a short list.

**NCCL chose the wrong interface.** On a node with a management NIC and several
fabric adapters, NCCL can select the wrong one. Verify rather than assume:

```bash
NCCL_DEBUG=INFO NCCL_DEBUG_SUBSYS=INIT,NET,GRAPH \
  mpirun -np 16 -map-by ppr:8:node ./build/all_reduce_perf -b 1G -e 1G -n 20
```

The output names each adapter it selected and prints the rings it constructed.
If it is using a socket transport where you expected InfiniBand, that is your
answer. `NCCL_IB_HCA` and `NCCL_SOCKET_IFNAME` constrain the choice.

**GPUDirect RDMA is not engaged.** Without it, every message stages through a
host bounce buffer. The `INIT` log says whether GDR is in use per device.
`NCCL_NET_GDR_LEVEL` controls how aggressively it is applied relative to PCIe
topology distance.

**PCIe ACS is enabled.** Access Control Services forces peer-to-peer transfers
up through the root complex instead of across the switch, which quietly destroys
intra-node bandwidth. It is a BIOS or `setpci` change, and it is worth checking
on every new node type.

**The topology is not what you think.** `NCCL_TOPO_DUMP_FILE` writes out the
topology NCCL detected. Compare it against `nvidia-smi topo -m` and against how
the machine is actually cabled. Ring construction is only as good as the
topology discovery underneath it.

## Correctness is a column too

The `#wrong` column exists for a reason. Run with `-c 1` at least occasionally.
A collective that returns wrong values under load is a hardware or driver fault,
and it is a much more serious finding than a disappointing bandwidth plateau. It
is also the kind of thing that shows up in a training run as a loss curve that
diverges for no apparent reason, days later, after a great deal of compute has
been spent.

## What to do with the result

Record the `busbw` plateau, the message size where the curve leaves the
latency-bound regime, the rank count, and the driver, NCCL and firmware
versions. Re-run it after every driver update and every firmware change.

Collectives degrade quietly. Nothing fails, nothing logs an error, and step time
drifts up by a percentage nobody notices until the quarter's throughput is
compared against the previous one. A five-minute benchmark on a known baseline
catches it the same day.
