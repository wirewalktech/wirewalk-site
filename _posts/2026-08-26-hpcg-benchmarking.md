---
title: "HPCG: the benchmark that tells you what the memory system can do"
date: 2026-08-26
category: Benchmarking
tags: [HPCG, Memory bandwidth, Sparse]
summary: >-
  HPCG reaches a small percentage of peak and that is the entire point. It
  measures the parts of the machine that actually limit most scientific codes.
---

High Performance Conjugate Gradients was written by the HPL authors as a
deliberate counterweight to their own benchmark. Where HPL is dense, regular
and compute-bound, HPCG is sparse, irregular, and limited by memory bandwidth
and communication latency. It exists because procurement decisions were being
made on a number that predicted almost nothing about real workloads.

The headline result is startling the first time you see it. A machine that hits
a large fraction of peak on HPL will typically return a low single-digit
percentage of peak on HPCG. Nothing is wrong. That gap is the honest distance
between what the floating point units can do and what the memory system can feed
them.

## What it actually runs

HPCG solves a sparse linear system with a preconditioned conjugate gradient
method. The preconditioner is a geometric multigrid with a symmetric
Gauss-Seidel smoother, and that choice is what makes the benchmark hard in an
interesting way.

Symmetric Gauss-Seidel is inherently sequential in its data dependencies. You
cannot simply vectorize your way out of it the way you can with a dense matrix
multiply. Implementations have to reorder, color or otherwise restructure the
sweep to expose parallelism, and doing that changes the convergence behavior,
which the benchmark checks. The rules constrain how much you are allowed to
change, which is what stops HPCG from degenerating into the same optimization
contest HPL became.

The result is a benchmark dominated by sparse matrix-vector products, which
means streaming large arrays with indirect indexing. Arithmetic intensity is
low. Every cycle spent waiting on a cache miss is a cycle the floating point
units sit idle.

## Configuration

The input is small. `hpcg.dat` takes a local problem size per rank and a run
time:

```
HPCG benchmark input file
Sandia National Laboratories; University of Tennessee, Knoxville
104 104 104
1800
```

The three numbers are the local subdomain dimensions `nx ny nz`, and they must
each be a multiple of eight. The fourth is the target run time in seconds.

**Sizing the local domain.** The subdomain has to be large enough that it does
not fit comfortably in cache, or you are benchmarking cache and the result is
meaningless. A reasonable approach is to size it so the working set is a
substantial fraction of the memory you want to represent per rank, then confirm
that increasing it further does not change the reported rate much. When the
number stops moving, you are measuring DRAM rather than last-level cache.

**Run time.** For an official submission the timed run must be at least 1800
seconds. For internal use you can run shorter, but be aware that short runs
overweight the setup phase and flatter the machine slightly.

<div class="note" markdown="1">
HPCG will happily produce a large number if you give it a small local domain.
This is the single most common way sites accidentally publish a wrong HPCG
result. Sweep the local size upward and take the value from the plateau, not
from the peak.
</div>

## What the output tells you

HPCG writes a YAML file with a full breakdown. The headline `GFLOP/s` rating is
what gets quoted, but the per-phase timings underneath are more useful
operationally, because they separate the sparse matrix-vector product, the
symmetric Gauss-Seidel sweeps, the dot products and the halo exchange.

Those phases fail differently:

- The **matrix-vector and smoother** phases track memory bandwidth. If they
  regress, look at DIMM population, memory clock, NUMA balance and whether
  something changed in the BIOS power profile.
- The **dot products** are global reductions, so they track collective latency
  and, more importantly, jitter. A single noisy node shows up here first.
- The **halo exchange** tracks neighbor communication, which is point-to-point
  and usually fine unless the topology mapping is poor.

That decomposition is why HPCG is worth running even when nobody is asking for
a TOP500-style number. It is a repeatable, structured way of asking whether the
memory subsystem and the collective path are behaving the way they did last
quarter.

## Where it fits against HPL

Run both. They fail for different reasons and finding the difference is
diagnostic.

| | HPL | HPCG |
|---|---|---|
| Limited by | Floating point throughput | Memory bandwidth, latency |
| Fraction of peak | High | Low |
| Sensitive to | Clocks, BLAS, thermals | DIMM config, NUMA, jitter |
| Representative of | Dense linear algebra | Most sparse scientific codes |

If HPL holds steady and HPCG drops, suspect memory configuration or a change in
NUMA behavior rather than the processors. If both drop together, suspect clocks,
power or cooling. If HPCG holds and HPL drops, suspect the math library or a
thermal limit that only sustained dense work reaches.

Neither benchmark predicts your applications. Together they bracket the machine
between what it can do when everything is favorable and what it can do when
almost nothing is, and most real codes live somewhere in between.
