---
title: "Feeding GPU analytics: Parquet layout and NVIDIA RAPIDS infrastructure"
date: "2025-08-27 10:00:00-04:00"
category: "Data Infrastructure"
tags: ["NVIDIA", "RAPIDS", "Spark", "Parquet", "Storage"]
summary: "Design storage and node resources for NVIDIA RAPIDS analytics, connecting Parquet layout, small-file overhead, GPU executor placement, host memory, transfer cost, and spill behavior."
description: "Design storage and node resources for NVIDIA RAPIDS analytics, connecting Parquet layout, small-file overhead, GPU executor placement, host memory, transfer cost, and spill behavior."
---

NVIDIA GPUs can accelerate supported analytical operations while leaving the job dominated by file discovery, CPU work, host-to-device transfers, or shuffle. Data layout and server balance determine whether an accelerated query receives useful work quickly enough.

Start with the actual query plan and storage path. Then evaluate the RAPIDS Accelerator for Apache Spark where its supported execution path matches the workload. The infrastructure objective is lower elapsed time and resource cost for a correct result, not moving every stage to a GPU.

## Design a balanced GPU analytics node

Budget CPU cores for parsing, scheduling, networking, and work that remains outside accelerated operators. Budget host RAM for the JVM, off-heap data, pinned transfer buffers, and spill. Add GPU memory and local scratch as separate capacity pools; compressed Parquet bytes are not an estimate of decoded device memory.

The [RAPIDS Accelerator 24.04 tuning guide](https://docs.nvidia.com/spark-rapids/user-guide/24.04/tuning-guide.html) specifies one executor per GPU for that release and separate controls for executor-task and GPU-task concurrency. Treat that mapping as a version-specific deployment constraint rather than copying generic CPU Spark executor sizing onto GPU nodes.

Inspect which physical operators use the GPU and where the plan crosses back to CPU execution. Transfer and conversion work can outweigh a short accelerated stage. Keep the CPU baseline on the same input snapshot, output semantics, and query set so that a comparison measures the proposed platform change.

## Join storage layout to GPU memory behavior

Test a few file and partition layouts using the projected columns and filters that users actually run. Record listing time, file opens, bytes read, decoded batch sizes, device memory peaks, shuffle, and spill. This reveals whether a faster kernel is hidden behind metadata or unnecessary input work.

A practical experiment is to hold the query fixed while changing only file consolidation, then hold layout fixed while enabling the accelerated path. That separates a storage-layout benefit from a compute benefit. Do not attribute both to the GPU when the CPU baseline also improves after compaction.

Pinned host memory and concurrent tasks need a joint budget. Too much pinned memory harms the host's ability to serve other work; too much simultaneous device demand can spill or fail. Measure two or more concurrent representative queries before deciding how many GPU executors a shared node can support comfortably.

Choose local NVMe scratch for its measured spill and recovery behavior, and define what happens to incomplete output if the node disappears. The layout and snapshot controls below remain necessary even when the accelerated operator itself is correct.

## Start from the queries and the update contract

List the common filters, projected columns, join keys, aggregation keys, and freshness requirements. Include occasional expensive investigations, not only the dashboard query that runs every minute.

Define how new data arrives and how old data changes. An append-only event log, an upserted customer table, and a repeatedly corrected scientific dataset need different publication and compaction policies. Readers also need a rule for identifying a consistent version.

Keep raw retention, curated analytical storage, and temporary query output distinct in the design. They may share infrastructure, but their access patterns and lifecycle obligations differ.

## Distinguish three ways to avoid reading

Partition pruning excludes whole directory or object groups based on partition values. Column pruning reads only requested columns from a suitable columnar representation. Row-group or page-level statistics may allow the engine to skip additional data inside files.

These mechanisms operate at different levels. A date partition is valuable when queries commonly restrict dates. It does little for a query that always reads all dates and filters only on an unrelated key. A columnar file helps a narrow projection even when no partition can be eliminated.

The [Apache Parquet format documentation](https://github.com/apache/parquet-format/tree/apache-parquet-format-2.10.0) describes row groups, column chunks, and pages. A format's ability to carry statistics does not guarantee that every writer produces useful statistics or that every query engine uses them for every predicate.

Verify the physical query plan and actual bytes read. A SQL predicate that looks selective is not proof of storage-level skipping, especially when casts, functions, or poorly organized values interfere with pruning.

## Partition on useful, bounded dimensions

A common starting point is a time dimension aligned with normal queries and ingestion. Add other dimensions only when their selectivity and cardinality justify the resulting layout.

Partitioning by a nearly unique identifier can produce huge numbers of tiny directories and files. Partitioning by a highly skewed tenant key can leave one enormous partition and many negligible ones. Neither outcome is repaired by calling the layout “distributed.”

Estimate partition counts and size distributions over the intended retention period. Evaluate growth, late arrivals, and exceptional tenants. An attractive layout for one month may become a metadata problem after several years.

Avoid encoding sensitive values into object names without considering where names appear in logs, inventories, and access tools. File naming is an information surface too.

## Measure the small-file tax

Tiny files create work before useful data processing begins: listing, metadata lookup, task scheduling, opens, and footer reads. In object storage, request latency and request counts can matter even when total bytes are modest. On a shared filesystem, metadata operations can become the limiting resource.

Use an illustrative comparison: one terabyte split into one million files presents a very different planning and opening workload from the same bytes split into several thousand files. That observation does not establish a universal ideal size. Large files can reduce parallelism for some readers or make small updates more expensive.

Measure planning time separately from scan time. Count files opened, tasks launched, bytes read, and useful rows returned. A result that improves only after caching the file listing points toward metadata or planning work rather than raw sequential bandwidth.

## Size files and row groups together with concurrency

File size influences task granularity and object overhead. Row-group size influences memory, statistics granularity, and opportunities for parallel reading. Compression changes the relationship between stored bytes and decoded memory.

Choose a few candidate layouts and benchmark the actual reader. Include narrow and wide projections, selective and broad filters, and realistic concurrent queries. Monitor decoded memory and spill, not just compressed bytes on disk.

Do not assume more partitions always mean more speed. Very fine task granularity can spend more time on scheduling than computation. Very coarse granularity can leave workers idle behind a small number of long tasks.

## Make compaction a correctness operation

Compaction rewrites layout without intending to change logical content. Verify that intent. Compare record keys, counts, duplicates, null handling, and aggregates appropriate to the data. Use stronger row-level or content checks where the consequences warrant them.

Publish the compacted version through a snapshot or manifest mechanism that prevents readers from mixing old and new files. An object directory is not automatically a transaction. Overwriting files while a long-running query lists and reads them can create an inconsistent view.

Retain old objects until the reader and recovery policy allows removal. A successful compaction write does not establish that all readers have stopped using the prior version.

## Include shuffle and joins in the diagnosis

A well-pruned scan can still feed a poor join. Inspect intermediate row counts, partition skew, shuffle bytes, spill, and the longest tasks. A many-to-many join can create more output than the original dataset by orders of magnitude.

The [Spark 3.5.1 tuning documentation](https://raw.githubusercontent.com/apache/spark/v3.5.1/docs/sql-performance-tuning.md) covers file scan partition controls, join strategies, and adaptive execution. Those controls influence execution; they do not remove the need to understand the data's keys and distributions.

Keep the scan and shuffle measurements separate so that a layout improvement is credited for what it actually changed.

## Keep an evidence-backed layout decision

Record the dataset snapshot, writer and reader versions, compression, partition columns, file and row-group size distributions, query set, cache state, concurrency, and measured results. Include the cost and operational duration of compaction.

Choose the layout that improves the important workload within the update and recovery constraints. Revisit it when query patterns or ingestion behavior change. The most useful data organization is the one that avoids unnecessary work while preserving a consistent, explainable dataset.
