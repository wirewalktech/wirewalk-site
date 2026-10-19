---
title: "PyTorch DataLoader bottlenecks on HPC GPU clusters"
category: AI Infrastructure
tags: ["PyTorch", "DataLoader", "GPU Training", "Parallel Storage"]
summary: "Diagnose slow PyTorch data loading on HPC clusters with per-rank timing, worker sweeps, storage checks, and reproducible GPU throughput measurements."
description: "Diagnose slow PyTorch data loading on HPC clusters with per-rank timing, worker sweeps, storage checks, and reproducible GPU throughput measurements."
date: "2026-06-12"
archive_date: true
featured: true
published_on: "2026-10-18"
last_reviewed: "2026-10-18"
series: "HPC and AI infrastructure engineering"
---

A GPU training job can spend more time waiting for its next batch than computing it. Before adding GPUs, measure the path from dataset storage through CPU preprocessing to the accelerator. The useful question is how much that path delays each training step.

This guide describes an investigation method, not a benchmark result. Use it with the documentation for your installed PyTorch release and with a representative slice of your own data.

## Separate the input pipeline from model execution

Start with three runs using the same model, batch size, precision and device placement:

1. Reuse a prepared batch already on the GPU. This estimates the model execution ceiling for that batch shape.
2. Reuse prepared batches in host memory. This introduces host-to-device transfer.
3. Read and transform the real dataset. This introduces filesystem access, decoding, augmentation and worker coordination.

The gaps identify where to investigate; they are not additive costs because stages can overlap. Keep the real run long enough to expose cache exhaustion and periodic stalls. Record warmup separately.

PyTorch's [performance tuning guide](https://docs.pytorch.org/tutorials/recipes/recipes/tuning_guide) documents worker subprocesses and pinned memory as ways to overlap preparation and transfers. Neither guarantees that your workload gets faster.

## Measure batch wait and step time correctly

Time how long the training process waits for the next batch and compare it with end-to-end step time. CUDA operations are asynchronous, so CPU timing around a model call alone does not measure completed GPU work. Use a profiler or CUDA events for GPU regions. For a short diagnostic measurement, synchronize at the boundaries; avoid leaving forced synchronization in the production loop because it changes overlap.

Report median and tail latency, not only the mean. Periodic long waits can dominate time to solution even when most batches arrive promptly. Use the [PyTorch profiler](https://docs.pytorch.org/docs/stable/profiler.html) to inspect CPU activity, GPU work and transfers together.

In distributed training, collect timings per rank. One process that receives batches late can hold up the others at synchronization. A healthy aggregate storage rate can coexist with one slow reader.

## Tune workers within the Slurm CPU allocation

Sweep a small set of worker counts while holding everything else fixed. Count workers across every training process on the node: eight ranks with four workers each create 32 loader workers, in addition to the ranks and any library threads.

Check the CPU allocation, affinity and actual CPU use before increasing concurrency. More workers can increase context switching, memory consumption and pressure on shared storage. Limit nested numerical-library threading when it competes with the loader, then measure again.

The [DataLoader reference](https://docs.pytorch.org/docs/stable/data.html) explains worker count, prefetching, persistent workers and memory pinning. Test these options individually. Persistent workers may reduce epoch startup overhead, but worker state and random-seed behavior still need attention. Prefetch depth consumes memory; it is a buffer, not additional storage bandwidth.

## Distinguish metadata pressure from bandwidth

A dataset containing many small files can stress metadata and file-open operations while moving relatively few bytes. A sequential read test does not reproduce that workload.

Compare representative access patterns: file sizes, randomization, number of readers, transforms, and cache state. Observe storage latency and metadata activity alongside throughput. If changing the data layout is feasible, evaluate a sharded format with the same samples and shuffle semantics. Larger shards can reduce file-open overhead, but shard assignment and shuffle quality become part of the experiment.

Node-local staging is another experiment. Include staging time in the result and verify capacity, cleanup and data-access policy. A faster training loop that first copies the entire dataset may take longer for a short job.

## Check pinned memory and host-to-device overlap

Pinned host memory can support faster transfers and asynchronous copies, but it occupies host RAM. Combine it with transfer behavior that actually allows overlap, and inspect the timeline rather than assuming an option enabled it.

Watch host memory and shared-memory use, especially in containers and multi-worker jobs. A worker failure or memory limit can look like an intermittent input stall. Keep a simple single-worker configuration available for diagnosis.

## Publish a reproducible result

Record samples or useful tokens per second, step-time distribution, batch wait per rank, worker count per rank, CPU allocation, host memory, dataset layout, cache conditions and software versions. Include startup and staging costs when reporting job completion time.

A successful change reduces wall-clock time for the same useful work without changing the sample population or training semantics. GPU busy percentage alone cannot establish that.

Continue with [GPU utilization and model FLOPs utilization](/writing/reading-gpu-utilization-mfu-honestly/), [IOR and mdtest storage benchmarking](/writing/ior-mdtest-parallel-storage/), and [Slurm efficiency accounting](/writing/slurm-efficiency-accounting-traps/).
