---
title: "Distributed AI checkpoints: storage performance and restart testing"
category: Parallel Storage
tags: ["PyTorch", "Checkpointing", "AI Training", "HPC", "Recovery"]
summary: "Measure distributed AI checkpoint stalls, storage contention, and restart time. Validate recoverable training state before tuning asynchronous saves."
description: "Measure distributed AI checkpoint stalls, storage contention, and restart time. Validate recoverable training state before tuning asynchronous saves."
date: "2026-06-10"
archive_date: true
featured: true
published_on: "2026-10-18"
last_reviewed: "2026-10-18"
series: "HPC and AI infrastructure engineering"
---

A checkpoint is useful when training can resume from it. A fast save call, a directory full of shard files, or an asynchronous task returning a handle does not establish that outcome.

For distributed AI training on HPC infrastructure, evaluate checkpointing as a recovery path: capture consistent state, persist it outside the intended failure boundary, discover a complete checkpoint, and restore useful computation. The method below is operational guidance, not a claim about measured product performance.

## Define the failure the checkpoint must survive

State whether the objective is surviving a process crash, a failed GPU node, loss of node-local storage, or loss of a shared filesystem. A checkpoint on local NVMe can help with some restarts while disappearing with the node it is meant to protect.

List the training state required for the intended restart. Depending on the framework and workflow, that can include model parameters, optimizer and scheduler state, step counters, random-number state and data-sampling progress. Model weights alone are not necessarily sufficient to continue the same training trajectory.

PyTorch's [distributed checkpoint tutorial](https://docs.pytorch.org/tutorials/recipes/distributed_checkpoint_recipe.html) describes parallel saving and loading across ranks. Check the supported state representation and restore procedure for your installed release and training strategy before choosing a format.

## Measure stall time separately from persistence time

There are at least three useful measurements:

- **Training stall:** how long useful training pauses to capture or stage state.
- **Save completion:** how long the checkpoint operation takes to finish writing through its storage interface.
- **Restart time:** how long a fresh job takes to locate, load and resume from the selected checkpoint.

Storage API completion does not by itself prove survival of every storage-system failure. Document the filesystem or object-store guarantees and the failure boundary you actually tested.

For asynchronous saving, record when the operation starts and when its completion result is observed. A short foreground call can hide substantial background I/O. Watch training step time while the write continues, because the checkpoint can compete for CPU, host memory, network and storage bandwidth.

## Treat asynchronous saves as bounded work

PyTorch's [asynchronous checkpoint recipe](https://docs.pytorch.org/tutorials/recipes/distributed_async_checkpoint_recipe.html) describes the memory overhead of staging and demonstrates waiting for the previous save before starting another. Use a bounded number of outstanding saves appropriate to the installed API and memory budget.

If saves take longer than the checkpoint interval, launching more saves can build a backlog rather than improve protection. Record which checkpoint has actually completed, handle completion errors, and ensure the final pending operation finishes before an orderly job exit.

A process killed during staging or writing must not cause the next job to select incomplete state. Use the framework's supported completion and discovery mechanism. For a custom format, define a completion protocol that all writers and readers follow, and test it under interruption; the existence of a directory is insufficient.

## Benchmark the shared filesystem under realistic concurrency

Test the intended rank and node counts. A single sequential writer cannot predict a distributed checkpoint with many shards and metadata operations. Measure per-rank completion times and the slowest participant, together with storage throughput and latency.

Include other representative jobs in a controlled contention test when possible. A checkpoint configuration that achieves excellent isolated bandwidth can still cause unacceptable stalls for neighboring training jobs.

For capacity planning, distinguish logical checkpoint size from actual bytes written, retained generations and temporary space. Compression, deduplication, replication and erasure coding change different layers of that accounting. Use observed storage consumption rather than assuming every layer reports the same number.

## Run the restart test in a fresh allocation

Use a disposable training run and separate checkpoint namespace. Never interrupt a production job merely to demonstrate this procedure.

1. Save a known step and confirm completion through the framework.
2. Terminate the disposable job, then start a fresh allocation without relying on its previous process memory or temporary files.
3. Restore the documented state and verify the resumed step, optimizer/scheduler state and data progress as applicable.
4. Run further steps and check expected training behavior within the workflow's numerical tolerances.
5. Interrupt a later save and confirm that recovery selects the last complete checkpoint or reports a clear failure.

If recovery after a changed world size is a requirement, test that exact configuration. Do not infer support for a new sharding layout from success with the original rank count. Preserve the runtime and dependency information needed to read retained checkpoints; portability across software versions needs its own test.

## Choose an interval from measured costs

Shorter intervals reduce the amount of completed work exposed to loss, but add save overhead and storage load. Longer intervals do the reverse. Base the choice on measured stall and restart times, the tolerated loss of progress, capacity and the failures the system needs to withstand.

Report the interval, checkpoint size, rank count, foreground stall, full completion time, contention impact, retained generations and fresh-allocation restore time. Those measurements let another engineer assess the tradeoff. Peak write bandwidth alone does not.

Related guides: [parallel storage benchmarking with IOR and mdtest](/writing/ior-mdtest-parallel-storage/), [multi-terabyte checksum verification](/writing/verifying-multi-terabyte-transfer-checksums/), and [what node reimaging erases](/writing/node-local-state-and-the-reimage-that-erases-it/).
