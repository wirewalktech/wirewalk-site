---
title: "HPL: what Linpack actually measures, and what it is good for"
date: 2026-08-19
category: Benchmarking
tags: [HPL, LINPACK, Acceptance]
summary: >-
  HPL is a poor predictor of application performance and an excellent acceptance
  test. Those two statements are both true, and confusing them is how people end
  up tuning the wrong thing.
---

High Performance Linpack solves a dense system of linear equations by LU
factorization with partial pivoting, in double precision, distributed across a
process grid. It is the benchmark behind the TOP500 list, which is why it
carries more political weight than technical weight.

The useful framing is this: HPL is a poor predictor of how your applications
will perform, and an excellent way to find out whether a machine is broken.
Both things are true at once, and most arguments about HPL come from people
holding one half of that and assuming the other half is wrong.

## Why it flatters hardware

The work HPL does is `(2/3)N³ + 2N²` floating point operations, and almost all of
it lands in large dense matrix multiplies. That is the single most favorable
operation any processor has: high arithmetic intensity, perfectly predictable
access, and vendor-tuned kernels behind it.

So HPL reaches a high fraction of theoretical peak, and a well-tuned run on
sensible hardware lands in the region of sixty to ninety percent of `Rpeak`.
Very little real scientific code behaves this way. Most applications are limited
by memory bandwidth, sparse or irregular access, latency, or synchronization,
none of which HPL exercises meaningfully.

That is precisely why HPCG was created as a counterweight, and it is why quoting
`Rmax` as a procurement figure of merit for a mixed workload is close to
meaningless.

## The parameters that matter

Everything lives in `HPL.dat`. Most of its knobs are noise; four are not.

| Parameter | What it controls | Practical guidance |
|---|---|---|
| `N` | Problem size | Fill most of aggregate memory, leaving headroom |
| `NB` | Block size | Match the BLAS kernel's preference |
| `P` × `Q` | Process grid | As close to square as possible, with `P` ≤ `Q` |
| `BCAST` | Broadcast algorithm | Try a few; the ring variants usually win at scale |

**Sizing `N`.** The matrix is `N × N` in eight-byte doubles, so memory is
`8N²` bytes plus workspace. Solve for the memory you want to use:

```
N ≈ sqrt( total_bytes × utilization / 8 )
```

Utilization around 0.8 is a reasonable starting point. Push it too high and the
run swaps or the OOM killer intervenes several hours in; too low and you spend
proportionally more time in the parts of the algorithm that do not scale, and
the result understates the machine.

**Choosing `NB`.** This is the blocking factor the factorization uses, and the
right value is whatever the underlying BLAS wants. CPU runs with a tuned library
typically want something in the low hundreds. GPU runs, particularly through a
vendor container, want considerably larger blocks, because the point is to keep
the device busy with big multiplies. Do not carry a CPU value across to a GPU
run and expect it to hold.

**The grid.** `P × Q` must equal the number of MPI ranks. The panel
factorization runs down columns of the grid and the update broadcasts across
rows, so a grid that is far from square puts a disproportionate amount of the
serial-ish work in one dimension. Square, or slightly wider than tall, is the
rule.

<div class="note" markdown="1">
Sizing `N` to fill memory means a full run takes hours. Do your parameter sweeps
at a small `N` where a run takes minutes, find the shape of the answer, then do
one or two large runs to get the real number. People routinely burn a week
tuning at full size.
</div>

## Where it earns its keep

Run HPL at close to full memory across every node, and you have built a
sustained, uniform, several-hour stress test that touches nearly all of DRAM,
nearly all of the floating point units, and the interconnect between every pair
of ranks. It is the best acceptance test most sites have, and it finds things:

- Nodes that thermally throttle only once the whole rack is hot, which no
  single-node test will reproduce.
- Correctable memory errors that appear only when a large fraction of DRAM is
  touched repeatedly.
- One node whose BIOS profile differs from its siblings, which shows up as the
  whole job running at the speed of that node.
- Links that negotiated at a lower width or rate than expected.
- Power delivery and cooling limits that only appear at full draw.

HPL prints a residual check at the end. Treat a failed residual as a hardware
fault until proven otherwise, because that is usually what it is. A machine that
returns wrong arithmetic under load is a much more urgent finding than a
disappointing `Rmax`.

## Reading the result honestly

`Rmax` is the best rate achieved. `Rpeak` is the theoretical maximum from clock
rate, core count and per-cycle floating point width. Efficiency is the ratio,
and it is the number worth tracking, because it is comparable across time on the
same machine.

A drop in efficiency between two runs of the same configuration is a real
signal. An absolute efficiency number compared against a different site's
machine is mostly a comparison of two vendors' BLAS libraries and two people's
patience with parameter sweeps.

Use HPL to prove the machine is healthy and to catch regressions after firmware
and driver changes. Use HPCG, and your own applications, to decide what the
machine is worth.
