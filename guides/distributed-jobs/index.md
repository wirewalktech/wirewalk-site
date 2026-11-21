---
layout: resource
title: Distributed jobs hang or scale poorly
seo_title: Distributed jobs hang or scale poorly
description: Work through launch, rank placement, communication paths and concurrent fabric behavior for MPI and NVIDIA GPU jobs.
parent_url: /guides/
parent_title: Problem guides
nav_section: guides
eyebrow: Start with the problem
---

## Start with one question

Can every intended rank launch, and does the same small job behave differently when the node list, GPU placement or physical rail changes? Keep those changes separate.

## A useful route through the evidence

1. **[Establish where progress stops](/writing/slurm-distributed-job-hangs-launch-ranks-fabric/)** — A rank that never launches and a rank stuck inside a collective call need different evidence.
2. **[Test from the lower layers upward](/writing/mpi-layered-test-methodology/)** — Use a bounded allocation and compare equivalent endpoints before changing the application.
3. **[Prove the communication path](/writing/ucx-transport-gpu-memory-debugging/)** — A device in inventory does not prove that ranks selected its transport or used GPU memory directly.
4. **[Interpret collective results](/writing/nccl-tests-collective-bandwidth/)** — Retain message size, node placement and the meaning of each bandwidth column.
5. **[Check the second rail](/writing/mpi-multirail-multileg/)** — Use hardware-counter deltas to distinguish a configured rail from one carrying the workload.

## Keep the first experiment small

Use a bounded test allocation or agreed maintenance window. Save the exact workload, node selection, software and configuration before changing one variable. A repeatable result from a small test is more useful than a large run whose conditions cannot be reconstructed.

[Download the benchmark run record](/assets/lab-tools/benchmark-manifest.json) and [acceptance checklist](/assets/lab-tools/acceptance-checklist.csv). The manifest is an illustrative starting template; fill in actual identities and criteria before using it as evidence.

## See how the investigation could look

[Read the related illustrative lab scenario](/investigations/gpu-rail-matching/). It explains the hypotheses, evidence and decision points without claiming a customer result.

[Explore the relevant service](/services/infiniband-roce-diagnostics/), [see sample deliverables](/samples/) or [read how procurement works](/procurement/). You can use the guides and tools without starting an engagement.
