---
title: "HPL-MxP: reading a mixed-precision result without fooling yourself"
date: 2026-09-01
category: Benchmarking
tags: [HPL-MxP, HPL-AI, Mixed precision, Tensor cores]
summary: >-
  HPL-MxP reports a much larger number than HPL on the same machine. Knowing
  exactly where that factor comes from is the difference between a useful
  measurement and a marketing slide.
---

HPL-MxP, previously published as HPL-AI, solves the same problem as HPL and
returns a much larger number. The machine did not get faster. Understanding the
gap is the whole value of the benchmark, and misunderstanding it is how the
number ends up in a slide deck meaning nothing.

## What it does differently

Classic HPL performs the LU factorization entirely in double precision. HPL-MxP
performs the factorization in a lower precision, then repairs the answer.

The sequence is:

1. Factorize the matrix in reduced precision, which is where the hardware's
   tensor or matrix units are fastest.
2. Use that low-precision factorization as a preconditioner.
3. Run an iterative refinement loop, in practice a Krylov solver such as GMRES,
   until the residual meets the same accuracy standard classic HPL must meet.

The final answer satisfies the same correctness criterion. The path there spent
most of its time in arithmetic the hardware executes at several times the rate
of double precision.

This is not a trick invented for benchmarking. Mixed-precision iterative
refinement is a legitimate, long-standing technique in numerical linear algebra,
and it is used in production solvers. The benchmark exists to reward hardware
that implements it well.

## Where the big number comes from

Here is the part that matters, and the part most often skipped.

HPL-MxP does not report the number of low-precision operations it performed. It
reports the operation count of the **equivalent double-precision HPL
algorithm**, `(2/3)N³ + 2N²`, divided by the time the mixed-precision run
actually took.

So the metric answers a specific question: *if you needed an HPL-accurate
solution to this system, how fast did you get one?* That is a fair and useful
question. It is not the same question as "how many double-precision floating
point operations per second can this machine sustain," and the answer must never
be substituted for `Rmax`.

<div class="note" markdown="1">
A machine's HPL-MxP rate and its HPL `Rmax` are not comparable quantities, and
the ratio between them is not an efficiency. It is a measure of how much the
low-precision units outrun the double-precision units on that hardware, filtered
through how well the refinement converged.
</div>

## What actually determines the result

Three things move the number, and only one of them is raw hardware.

**The precision used for the factorization.** FP16, BF16 and TF32 have different
dynamic range and different mantissa widths, and they are not interchangeable.
BF16 keeps FP32's exponent range with a short mantissa, which makes it robust
against overflow but coarse. FP16 has a finer mantissa and a much narrower
range, so it needs scaling to stay numerically safe. Which one performs better
is a hardware question; which one converges better is a numerical one.

**How many refinement iterations were needed.** Every iteration costs time and
none of it counts toward the reported operation count, because the count is
fixed at the classic HPL figure. A run that converges in a handful of iterations
posts a strong number. A run that struggles posts a weak one even on identical
hardware. Convergence depends on the conditioning of the generated matrix and on
the precision choice, which is why the benchmark specifies how the matrix is
produced.

**The usual HPL parameters.** Problem size, block size and process grid still
matter, and the tuning intuition carries over, though the optimum block size is
generally larger because the point is to keep wide matrix units saturated.

## When it is worth running

Run it if you are buying or operating hardware where the low-precision units are
a large fraction of what you are paying for. On a GPU cluster intended for
training workloads, the double-precision rate may be close to irrelevant to
everything the machine will actually do, and HPL alone will undersell it badly.

Run it as a companion to HPL rather than a replacement. The pair tells you two
different things about the same machine: HPL gives you the double-precision
ceiling and a hardware health check, HPL-MxP gives you an indication of how well
the reduced-precision path performs on a problem with a verifiable answer.

Do not run it expecting it to predict training throughput. It does not model
attention, it does not model collectives at scale, it does not model the data
pipeline, and it does not model memory capacity pressure. For that question,
measure collectives directly with nccl-tests and then measure your actual model.

## Reporting it responsibly

If you publish an HPL-MxP figure, publish the precision used for the
factorization, the iteration count, the problem size, and the classic HPL result
from the same machine alongside it. Without those four pieces, the number is
unfalsifiable, and an unfalsifiable performance number is worth what it costs to
produce.
