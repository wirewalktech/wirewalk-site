---
layout: resource
title: We need to accept a new cluster
seo_title: We need to accept a new cluster
description: Plan independent HPC and AI acceptance around useful workloads, correctness, recovery and a reproducible handover.
parent_url: /guides/
parent_title: Problem guides
nav_section: guides
eyebrow: Start with the problem
---

## Start with one question

What research must the delivered system support, with what correctness, turnaround and recovery criteria? Agree this before comparing any headline benchmark.

## A useful route through the evidence

1. **[Choose what each test establishes](/writing/hpl-benchmarking/)** — A compute result is useful evidence for its scope; it cannot stand in for the research workload.
2. **[Measure the communication baseline](/writing/osu-micro-benchmarks/)** — Record placement and binding, then add the concurrency the real workload needs.
3. **[Qualify GPU communication](/writing/nccl-tests-collective-bandwidth/)** — Check intra-node and inter-node behavior without substituting a headline collective result for application work.
4. **[Include shared-storage behavior](/writing/ior-mdtest-parallel-storage/)** — Test bulk and metadata paths with agreed data, layout and concurrency.
5. **[Recover useful work](/writing/distributed-ai-checkpoint-storage-restart-testing/)** — Verify a restart and its recovery objective, not just the existence of a checkpoint file.

## Keep the first experiment small

Use a bounded test allocation or agreed maintenance window. Save the exact workload, node selection, software and configuration before changing one variable. A repeatable result from a small test is more useful than a large run whose conditions cannot be reconstructed.

[Download the benchmark run record](/assets/lab-tools/benchmark-manifest.json) and [acceptance checklist](/assets/lab-tools/acceptance-checklist.csv). The manifest is an illustrative starting template; fill in actual identities and criteria before using it as evidence.

## See how the investigation could look

[Read the related illustrative lab scenario](/investigations/gpu-rail-matching/). It explains the hypotheses, evidence and decision points without claiming a customer result.

[Explore the relevant service](/services/hpc-ai-benchmarking/), [see sample deliverables](/samples/) or [read how procurement works](/procurement/). You can use the guides and tools without starting an engagement.
