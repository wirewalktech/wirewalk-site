---
layout: resource
title: Our GPUs are waiting on something
seo_title: Our GPUs are waiting on something
description: Trace GPU idle time through input, CPU work, device communication and checkpoint I/O, then choose the next useful experiment.
parent_url: /guides/
parent_title: Problem guides
nav_section: guides
eyebrow: Start with the problem
---

## Start with one question

Does a slow interval occur before a batch is ready, during computation, during a collective, or at a checkpoint? Record a short representative timeline rather than averaging the whole run.

## A useful route through the evidence

1. **[Read utilization carefully](/writing/reading-gpu-utilization-mfu-honestly/)** — Busy time is not useful arithmetic. Establish step timing and the kind of work being performed.
2. **[Measure the input path](/writing/pytorch-dataloader-bottlenecks-hpc-gpu-training/)** — Separate sample discovery, reads, decompression, transforms and host-to-device delivery.
3. **[Follow a timeline](/writing/nsight-systems-compute-cache-core-analysis/)** — Connect waiting periods to CPU, CUDA and communication activity before choosing kernel counters.
4. **[Join telemetry to a job](/writing/dcgm-gpu-telemetry-job-attribution/)** — Retain device identity, allocation and sampling context.
5. **[Include save and restart](/writing/distributed-ai-checkpoint-storage-restart-testing/)** — Steady-state throughput is only part of the time researchers spend waiting.

## Keep the first experiment small

Use a bounded test allocation or agreed maintenance window. Save the exact workload, node selection, software and configuration before changing one variable. A repeatable result from a small test is more useful than a large run whose conditions cannot be reconstructed.

[Download the benchmark run record](/assets/lab-tools/benchmark-manifest.json) and [acceptance checklist](/assets/lab-tools/acceptance-checklist.csv). The manifest is an illustrative starting template; fill in actual identities and criteria before using it as evidence.

## See how the investigation could look

[Read the related illustrative lab scenario](/investigations/gpu-acs-peer-traffic/). It explains the hypotheses, evidence and decision points without claiming a customer result.

[Explore the relevant service](/services/nvidia-gpu-ai-infrastructure/), [see sample deliverables](/samples/) or [read how procurement works](/procurement/). You can use the guides and tools without starting an engagement.
