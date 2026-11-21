---
layout: resource
title: Storage performance is inconsistent
seo_title: Storage performance is inconsistent
description: Separate client behavior, metadata, cache, concurrency and fabric limits before changing a parallel filesystem.
parent_url: /guides/
parent_title: Problem guides
nav_section: guides
eyebrow: Start with the problem
---

## Start with one question

Does the slowdown follow a client, an input layout, concurrency, a storage target or a network direction? Compare a controlled workload under matched cache conditions.

## A useful route through the evidence

1. **[Define the storage test](/writing/ior-mdtest-parallel-storage/)** — Record API, file layout, ranks, dataset size, cache procedure and durability semantics.
2. **[Check the direction of traffic](/writing/when-storage-is-actually-the-fabric/)** — A read/write imbalance can be produced by routing even when disks and average fabric graphs show headroom.
3. **[Inspect metadata demand](/writing/lustre-metadata-capacity-performance-operations/)** — File count and simultaneous opens can matter more than bulk throughput.
4. **[Follow the missing client path](/writing/gpfs-multihomed-storage-arp-source-routing/)** — Inspect source-qualified routes, neighbor discovery and effective storage connections.
5. **[Keep measurement semantics intact](/writing/measuring-compression-parallel-filesystem/)** — Allocated blocks, logical bytes and useful application output answer different questions.

## Keep the first experiment small

Use a bounded test allocation or agreed maintenance window. Save the exact workload, node selection, software and configuration before changing one variable. A repeatable result from a small test is more useful than a large run whose conditions cannot be reconstructed.

[Download the benchmark run record](/assets/lab-tools/benchmark-manifest.json) and [acceptance checklist](/assets/lab-tools/acceptance-checklist.csv). The manifest is an illustrative starting template; fill in actual identities and criteria before using it as evidence.

## See how the investigation could look

[Read the related illustrative lab scenario](/investigations/storage-feeding-gpus/). It explains the hypotheses, evidence and decision points without claiming a customer result.

[Explore the relevant service](/services/parallel-storage/), [see sample deliverables](/samples/) or [read how procurement works](/procurement/). You can use the guides and tools without starting an engagement.
