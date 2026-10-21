---
title: "Lustre striping for AI and HPC: match layouts to the workload"
category: Parallel Storage
tags: ["Lustre", "Parallel Storage", "AI Infrastructure", "Performance"]
summary: "Choose and test Lustre stripe layouts for AI datasets, shared HPC files and checkpoints. Inspect actual file layouts and compare performance without global changes."
description: "Choose and test Lustre stripe layouts for AI datasets, shared HPC files and checkpoints. Inspect actual file layouts and compare performance without global changes."
date: "2026-07-11"
featured: true
last_reviewed: "2026-10-18"
series: "AI and HPC storage engineering"
---

Lustre stripe count is a workload decision. A checkpoint shared by many ranks, one file per process and millions of small training samples do not need the same layout. Setting every file to span every target can add overhead without improving the work the application completes.

This guide describes a bounded experiment using disposable data. It does not recommend a filesystem-wide default or a universal stripe size.

## Understand the layout before tuning it

Lustre separates metadata service from file data stored on object storage targets, or OSTs. A file layout describes how its data is distributed. Stripe count and stripe size govern different aspects of that distribution; neither is equivalent to the number of disks in the storage system.

The project's [file striping guide](https://wiki.lustre.org/Configuring_Lustre_File_Striping) documents inspecting layouts and setting directory defaults. Use your installed manual pages for the exact supported options and layout features.

Start with read-only inspection of a representative file and its parent:

```bash
lfs getstripe /path/to/lustre/dataset/example-file
lfs getstripe -d /path/to/lustre/dataset
```

Do not infer an existing file's layout from the current parent default. Record both, together with client/server versions and the targets available to the test.

## Classify the application's access pattern

Describe whether ranks share a file or create independent files. Record transfer size, alignment, file size, reader/writer count, access ordering and synchronization points. Include metadata activity and checkpoint cadence.

For many independent files, concurrency already exists across files and clients. Wider striping within every small file may add little value. For a large shared file, a narrow layout may constrain the targets that can participate. These are hypotheses to test, not automatic prescriptions.

AI dataset representation matters too. Sharding many samples into larger containers changes both metadata demand and the I/O pattern. Compare throughput while preserving the sample population, transforms and shuffle requirements.

## Use a separate directory for each layout experiment

Create disposable test directories through the site's normal process. Set the intended layout before creating the test files, verify the resulting file layouts, and retain the commands with the result.

A directory default governs newly created files; changing it is not a bulk rewrite of existing data. Moving or rewriting existing files is a separate operation with space, load and recovery implications.

Choose a small layout matrix agreed with the storage team. Hold the dataset, rank placement, software and cache conditions fixed. Compare the application's time to solution, not only a synthetic peak. Avoid production mount-wide changes for an experiment whose outcome is still unknown.

## Consider progressive layouts for mixed file sizes

Progressive file layouts allow a file's layout to change across size ranges. The Lustre project's [striping best practices](https://wiki.lustre.org/Lustre_Striping_Best_Practices) discusses this and other layout choices. Confirm feature support and the current site policy before experimenting.

Mixed-size workloads are a reason to evaluate a progressive policy, not proof that a particular threshold is appropriate. Measure small-file overhead, large-file throughput and metadata costs together. Document the actual layout selected for each size range so the result can be reproduced.

## Separate layout from the rest of the data path

When increasing stripe count stops helping, inspect client CPU, network delivery, target load, backend devices and application synchronization. A layout cannot create bandwidth beyond the path's limiting component.

Compare shared-file and file-per-process behavior when the application permits it. Include close and synchronization time in write tests; timing only submission can omit costs the next stage must pay. Record warm-cache and capacity-scale behavior separately.

If a layout helps isolated bandwidth but worsens other jobs' latency, the operational result needs more work. The storage system is shared, and a configuration that wins one synthetic test may be unsuitable as a general default.

## Keep a layout decision record

For a useful result, retain layout output, file sizes/counts, client and rank placement, concurrency, useful throughput, tail latency and errors. State whether the test used a fresh dataset or a warm cache, and whether other load was present.

Adopt a layout when it improves the intended workload within acceptable shared-system costs. Revisit that choice when dataset shape, concurrency or storage hardware changes.

Continue with [Lustre metadata and capacity diagnosis](/writing/lustre-metadata-capacity-performance-operations/), [IOR and mdtest methodology](/writing/ior-mdtest-parallel-storage/), and [AI checkpoint recovery](/writing/distributed-ai-checkpoint-storage-restart-testing/).
