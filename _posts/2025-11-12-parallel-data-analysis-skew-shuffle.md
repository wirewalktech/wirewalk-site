---
title: "Scaling NVIDIA GPU analytics: RAPIDS, shuffle, and straggler diagnosis"
date: "2025-11-12 10:00:00-05:00"
category: "Data Infrastructure"
tags: ["NVIDIA", "RAPIDS", "Parallel Analysis", "Shuffle", "Nsight Systems"]
summary: "Diagnose parallel GPU analysis through Spark plans, RAPIDS task concurrency, host and device spill, shuffle traffic, Nsight traces, and controlled scaling with verified output equivalence."
description: "Diagnose parallel GPU analysis through Spark plans, RAPIDS task concurrency, host and device spill, shuffle traffic, Nsight traces, and controlled scaling with verified output equivalence."
---

A GPU analytics job completes most tasks quickly and waits for a few oversized partitions. More NVIDIA devices cannot share work that remains trapped behind one hot key, a bad join, or a single long-running task. The useful diagnosis crosses the query plan, GPU memory, host memory, storage, and network.

Use the longest stage and partition distribution to decide whether the next intervention is a query rewrite, a concurrency change, more memory, or a fabric improvement. Keep a correct CPU or existing distributed result as the reference throughout.

## Separate the Spark plan from the GPU execution path

With RAPIDS Accelerator, inspect the executed plan to identify accelerated operators and CPU transitions. A cluster containing GPUs is not evidence that a particular query used them effectively. Unsupported or unsuitable parts of a plan can retain CPU and transfer costs even when some stages accelerate.

The [RAPIDS 24.04 tuning guide](https://docs.nvidia.com/spark-rapids/user-guide/24.04/tuning-guide.html) distinguishes concurrent executor tasks from tasks actively sharing the GPU. For an investigation, vary those controls independently within a safe memory budget. Increasing CPU-side concurrency may improve input preparation or may multiply buffered data and spill; the task timeline should show which happened.

Keep one executor mapped to one GPU for that documented release. Record the executor's host-memory budget and overhead as well as device memory. A GPU out-of-memory incident and a killed JVM are different failures and need different evidence.

## Attribute the tail across device, host, and fabric

For the slowest partitions, collect input rows and bytes, shuffle read and write, device spill, host spill, local-disk activity, and retries. A hot partition can saturate its assigned GPU while the rest of the cluster appears idle. A transport-limited stage can instead leave every GPU waiting.

Use a short [Nsight Systems 2024.2](https://docs.nvidia.com/nsight-systems/2024.2/UserGuide/index.html) capture when the application and access policy permit it. Correlate kernel activity and transfers with stage boundaries rather than collecting a long trace with no hypothesis. Rerun timing without profiling to check the observer's overhead.

A ConnectX-equipped fabric can be part of the design, but do not assume a Spark shuffle uses GPUDirect RDMA because the hardware supports it. Establish the plugin, transport, and release-specific configuration actually in use. Measure relevant network traffic and compare the executed path before crediting a fabric feature with a speedup.

The skew and join transformations below should be accepted only after output comparison. Faster movement of an accidentally multiplied join result is an infrastructure expense, not a successful analysis.

## Establish a correct reference result

Before optimizing, preserve an input snapshot and an accepted output. For a dataset too large for complete row-by-row comparison, define meaningful invariants: distinct keys, row counts, null counts, sums, group totals, and selected exact outputs. Use stronger comparison where approximate checks could miss consequential errors.

For floating-point reductions, decide whether equivalence means bitwise equality or agreement within a justified tolerance. Changing reduction order can change low-order bits without changing the intended numerical conclusion. Conversely, a wide tolerance can hide real data loss.

Keep input versions and query code fixed during performance comparisons. A faster run against fewer records is not evidence of a better execution plan.

## Decompose the elapsed time

Separate startup, source discovery, scanning, parsing, local transformation, shuffle, aggregation, output writing, and commit or publication. Capture stage-level timing and task distributions, not only job duration.

The original [MapReduce paper from 2004](https://www.usenix.org/conference/osdi-04/mapreduce-simplified-data-processing-large-clusters) describes a map and reduce execution model for large datasets. Its enduring diagnostic lesson for this discussion is that data movement and partitioned work are visible parts of the computation. The investigation sequence here is a proposed operating method.

Measure wall time alongside CPU time, bytes read, bytes shuffled, spill, and failures. A task using little CPU may be blocked on input, memory pressure, or another dependency. High CPU can mean useful computation or repeated serialization.

## Find the long tail

Compare median, upper-percentile, and maximum task durations. Inspect the slowest tasks for input bytes, record counts, key distributions, garbage collection, spill, and retries.

A few slow tasks can indicate skew: a popular key, a single exceptionally large record, or one partition containing a disproportionate share of the data. Uniform task sizes with uniformly poor performance suggest a broader bottleneck. Tasks that become slow on one specific host suggest an infrastructure issue rather than a global query problem.

Do not average away the evidence. If one partition contains half the records, adding workers does not split that partition unless the execution plan or data organization changes.

## Check join cardinality before tuning the transport

Verify uniqueness assumptions on both sides of every important join. If one key appears m times on one side and n times on the other, that key can produce m times n joined rows. Unexpected duplicates can create a huge intermediate result while every network counter behaves normally.

Record row counts before and after the join. Inspect the largest key groups and compare against the intended relationship. A many-to-many result may be valid, but its cost should be deliberate.

Filter early where semantics permit and project away unused columns before a wide shuffle. Preaggregate only when it preserves the result. For example, combining partial sums is straightforward; combining partial averages requires carrying counts as well as sums.

## Treat skew with a specific transformation

For a hot aggregation key, a two-stage reduction may help: distribute records across temporary subkeys, compute partial results, then combine by the original key. The combining function must be valid for the aggregate. Exact distinct counts and nonassociative operations need more care than sums.

For a skewed join, salting a key can redistribute one side while replicating the matching records from the other side. That replication has a cost and must preserve match multiplicity. Validate null semantics, duplicate behavior, and the treatment of keys that are not skewed.

A broadcast join can avoid a large shuffle when one side is genuinely small enough for the workers' memory and the engine supports the required join semantics. Measure the in-memory representation and concurrent workloads; compressed file size is an unsafe memory estimate.

The [Spark 3.5.1 tuning reference](https://raw.githubusercontent.com/apache/spark/v3.5.1/docs/sql-performance-tuning.md) documents adaptive execution and skew handling. Inspect the executed plan to see whether the expected optimization actually occurred.

## Understand memory and spill

A partition may fit on disk and still exceed the memory available for sorting, hashing, decoded columns, and runtime overhead. Spill can be a normal safety mechanism, but repeated spill and reread can dominate execution.

Check per-worker concurrency. Giving an executor many simultaneous tasks also divides its practical memory budget among those tasks. Increasing task concurrency can make every task slower if they compete for the same memory and local storage.

Measure local scratch capacity and throughput, and ensure temporary data has an appropriate lifecycle. A retry storm caused by exhausted scratch can resemble a distributed scheduling problem while its root cause is local storage pressure.

## Scale with a fixed question

For strong scaling, hold the dataset and computation fixed while changing resources. Record speedup and resource efficiency. For weak scaling, increase work with resources and report whether time remains stable. Do not mix the two interpretations.

An illustrative job has twenty minutes of parallel work and five minutes that cannot be parallelized. Doubling workers can at best reduce the parallel portion to ten minutes under ideal conditions, giving fifteen minutes overall rather than twelve and a half. Real communication and scheduling costs can reduce the gain further.

The [2010 Spark paper](https://www.usenix.org/conference/hotcloud-10/spark-cluster-computing-working-sets) introduced an approach to reusing working sets across parallel operations. Reuse can matter, but caching every intermediate is not a universal optimization: measure reuse, eviction, and recomputation cost.

## Publish the optimization with its correctness evidence

For every accepted change, preserve the original and revised plans, stage distributions, resource configuration, elapsed time, and output comparison. Repeat enough runs to distinguish the effect from cache and load variation, while stating which cache state each run represents.

An optimization is ready when it removes a measured bottleneck and preserves the defined result. More workers are one possible tool. Better partitioning, fewer bytes, or a corrected join can be the more direct answer.
