---
title: "Progress estimates over unevenly sized work are wrong by construction"
category: Operations
tags: ["Observability", "Monitoring", "Data Transfer", "Progress Estimation", "Capacity Planning", "SRE"]
summary: >-
  Completion order correlates with size, so the first items to finish are the
  small ones. Any rate extrapolated from early completions is biased, and on a
  long transfer it can be wrong by more than an order of magnitude.
description: "Why percent-complete and ETA mislead when work items vary in size, how byte-weighted progress fixes it, and which monitoring signals distinguish stalled from slow."
date: "2026-10-14"
archive_date: true
published_on: "2026-10-17"
last_reviewed: "2026-10-17"
series: "HPC and AI infrastructure engineering"
---

Mid-way through a long job, someone asks how long it has left. There is a number available —
items done over elapsed time, extrapolated — and it is usually wrong in a specific, predictable
direction.

A concrete case. A verification pass over a large object store reported, from its first seven
completed objects, a rate of about **660 MB/s** and an estimate of **26 hours**. The completed
pass ran at **11.4 GiB/s** and finished in **88 minutes**. Wrong by roughly 17x, pessimistic.

Nothing was broken, and the arithmetic was right. The sample was biased by construction.

## Why the early sample is always unrepresentative

If items are processed concurrently and they differ in size, the ones that complete first are
disproportionately the small ones. That is not bad luck; it is what "finishes first" means. So
at any early moment, the completed set is a size-biased sample of the work, and the mean item
duration computed over it understates the remaining mean.

Two consequences, in opposite directions, depending on what you divide by:

- **Items per second** extrapolated from early completions is **too fast** — you will promise
  an early finish and miss it, because the large items are all still ahead of you.
- **Bytes per second** computed as (bytes done / elapsed) while large items are in flight is
  **too slow** — the bytes already read inside incomplete items are not counted anywhere, so
  the numerator is missing most of the work actually performed.

The 17x error above is the second kind: twenty-four multi-terabyte objects were being read
concurrently, and none had completed, so none of their bytes were in the numerator.

## Count the work in the unit the work is actually in

The fix is not a better estimator. It is a better denominator.

For a transfer or a scan, the total is **known in bytes before you start** — a listing gives
you sizes. So progress should be byte-weighted:

```
percent = bytes_completed / bytes_total
```

and the rate should come from a **windowed delta** of a monotonic byte counter, not from a
cumulative average since start:

```
rate = (bytes_at_t2 - bytes_at_t1) / (t2 - t1)
```

The cumulative average answers "what has the average rate been", which is not the question. The
question is "what is the rate now", because that is what multiplies the remaining bytes.

If the tool can report in-progress bytes per item — many can, via a temp-file size or its own
progress output — count them. If it cannot, acknowledge the floor explicitly: with N large items
in flight and no partial accounting, your byte counter is a lower bound and your rate is a lower
bound, and you should present them as such rather than as an estimate.

## Counters are not rates

This is the same error in a different costume, and it is endemic in homegrown dashboards. A
counter exposed as a gauge gets plotted as a line that climbs forever, and someone reads the
height of the line as throughput.

```promql
# wrong: a monotonically increasing total, rendered as if it were a rate
transfer_bytes_total

# right
rate(transfer_bytes_total[5m])
```

The corollary that bites later: a process restart resets the counter, `rate()` handles that
correctly, and a hand-rolled `(now - previous) / interval` does not — it produces a large
negative number that the panel renders as a dropout. If you are computing deltas yourself,
clamp at zero and treat a reset as a gap rather than a value.

## Distinguish stalled from slow, because they need different responses

"Percent complete is not moving" has at least four causes, and the dashboard should separate
them:

| Observation | Meaning |
|---|---|
| byte counter rising, item counter static | Working normally on large items |
| byte counter static, workers present | Stalled — blocked on I/O, lock, or remote end |
| both static, no workers | Exited; check why, and whether it is restartable |
| item counter rising, byte counter barely moving | Grinding through many small items; metadata-bound |

The third row is the only one that needs a human immediately, and the first row is the one most
often mistaken for the second. A single percent-complete number cannot tell them apart, which
is the practical argument for publishing the two counters separately rather than only their
ratio.

Add one more signal that costs nothing and resolves most ambiguity: **time since last
completion**, and **time since the byte counter last changed**. A job with 40 minutes since its
last completed item but a byte counter that moved four seconds ago is healthy and working on
something big.

## Reporting rate honestly

Three rules that have survived contact with people who make decisions on these numbers:

1. **Never report a rate computed from fewer completions than you have concurrent workers.**
   With 24 workers and 7 completions, there is no rate yet. "Running, N items complete, no
   reliable rate until the large items land" is a better answer than a number.
2. **Report the window.** "11.4 GiB/s over the full 88-minute pass" and "660 MB/s over the
   first four minutes" are both true and mean completely different things. A rate without its
   window is not checkable.
3. **State the unit of the denominator.** Percent of items and percent of bytes diverge
   enormously on skewed data — one object in a thousand can be most of the dataset.

And the discipline behind all three: if an estimate is going to be repeated to someone else,
say what it is extrapolated from. The 26-hour figure was not dishonest; it was an extrapolation
from seven small objects, and had it been reported that way nobody would have planned around it.

## A note on the same bias in scheduling and benchmarks

The pattern is not specific to transfers.

- **Scheduler backfill**: the jobs that start first are the small ones that fit the gaps, so
  queue-wait statistics computed over completed jobs understate the wait for large jobs. Segment
  by size class or the metric is an average of two different populations.
- **Synchronized benchmarks**: a collective finishes when its slowest participant finishes, so a
  mean over ranks tells you very little and one degraded node sets the result for the whole run.
  Check the distribution, and check every participant's link before trusting a number.
- **Index or scan jobs over a filesystem**: directory entry counts are wildly skewed, so
  "directories processed" is close to meaningless as progress. Weight by entries.

## Symptom against cause

| Symptom | Cause | Fix |
|---|---|---|
| ETA shortens then balloons | Item-count extrapolation, small items first | byte-weighted progress |
| Reported rate far below hardware capability | Large items in flight, partial bytes uncounted | windowed delta; count partials or state the floor |
| Rate graph shows a cliff to negative | Counter reset computed by hand | `rate()`, or clamp and treat as a gap |
| Percent static, job healthy | One large item in progress | publish bytes and items separately |
| Early estimate repeated as a commitment | Rate reported without its window | always report the window and the sample size |

The principle: **a percentage is a ratio, and most of the error lives in the denominator.** Get
the denominator into the unit the work is actually measured in, take rates from a window rather
than from the beginning of time, and refuse to produce an estimate before the sample can
support one.
