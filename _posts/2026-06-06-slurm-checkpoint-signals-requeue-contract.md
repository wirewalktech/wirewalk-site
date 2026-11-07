---
title: 'Slurm checkpoint signals and requeue: make a restarted job continue the experiment'
date: 2026-06-06 10:00:00 -0400
category: HPC Operations
tags:
- Slurm
- Checkpointing
- NVIDIA GPUs
- Linux
summary: Design a restart contract around Slurm signals, durable checkpoints and bounded retries so a requeued training
  or simulation job resumes useful work rather than repeating it.
seo_title: Slurm Checkpoint Signals, Requeue and Restart Testing
description: Design Slurm checkpoint signals and bounded requeue behavior around durable application state, then
  test recovery on a different allocation.
---

A requeued job starts its batch script again. It does not resume the instruction that was executing when the node failed. If the application cannot identify a complete checkpoint and restore the experiment from it, a restart may quietly spend another allocation repeating work.

The scheduler, application and storage system each have a role. Slurm supplies allocation and lifecycle events. The application decides what a consistent checkpoint means. Storage must retain that state beyond the failure you are trying to survive. Design the interface between them before enabling automatic retries.

## Write down the restart contract

For a simulation, state might include the physical model, iteration, random generator and partitioning assumptions. For training, it can include model weights, optimizer and scheduler state, random generators, data position and configuration. Decide which parts are essential for scientific continuation and which only affect reproducibility within an acceptable tolerance.

Give the experiment a stable run identifier that survives allocation changes. Keep attempt identifiers separate. A job ID is useful evidence about an execution attempt; it is a poor sole key for the scientific run when a workflow can resubmit work under another ID.

The startup path should find the newest complete compatible checkpoint, validate its manifest and either restore it or explain why it cannot. Do not silently start a fresh experiment because a file is unreadable. That converts a recovery failure into plausible-looking output from a different run.

## Send warnings to the process that can act on them

The [sbatch signal reference](https://slurm.schedmd.com/sbatch.html) distinguishes signals to job steps from signals to the batch shell. The `B:` prefix targets the shell; without it, the warning targets job steps. Choose deliberately according to the launcher and application.

An illustrative batch header for an application launched as a Slurm step is:

```bash
#!/bin/bash
#SBATCH --job-name=restart-test
#SBATCH --time=00:30:00
#SBATCH --signal=USR1@180
#SBATCH --requeue
set -euo pipefail
srun python train.py --run-directory /shared/experiments/example-run
```

The path and program are placeholders. This script does not implement checkpointing. Test that the real process receives the signal under the site's launcher, container and process-management configuration. The warning can arrive earlier than the requested offset because of Slurm event resolution; it is not an exact timer.

A signal handler should generally request a checkpoint rather than perform complex distributed I/O directly. Let the training loop reach an agreed safe point and coordinate ranks through the application's supported mechanism. One rank writing while the others advance can produce a set of files that all exist but do not represent the same state.

## Budget time for the slow part of saving

Measure checkpoint completion under realistic storage contention, including close, synchronization and publication. An isolated write benchmark does not tell you how long the application needs when many jobs approach their wall-time limits together.

As a hypothetical sizing exercise, if the slowest accepted checkpoint takes 80 seconds and safe-point coordination takes another 20, a 60-second warning cannot accommodate it. Add operational margin and test the result. Do not treat a percentile from three clean runs as a reliable tail estimate.

Failure can occur without a warning. Periodic checkpoints should bound lost work when the node disappears abruptly. End-of-time warnings can reduce additional loss, but they do not replace an ongoing recovery policy.

## Publish only complete state

Write each checkpoint into a distinct generation. Keep its component list, versions, logical progress and integrity information in a manifest. Publish a completion marker only after the application's required writes and durability operations finish. The implementation needs filesystem-specific review; rename visibility alone does not prove persistence across every failure mode.

For a multi-rank run, define whether the manifest represents all ranks or independent recoverable shards. Validate the expected topology and checkpoint format at load time. Restoring on fewer GPUs may require an explicit resharding capability rather than merely changing the resource request.

See [distributed checkpoint storage and restart testing](/writing/distributed-ai-checkpoint-storage-restart-testing/) for the storage side of this contract.

## Separate retry eligibility from retry policy

`--requeue` permits requeue under applicable Slurm conditions; it does not automatically turn every application exit into another attempt. The site's failure and preemption configuration determines which events cause requeue. Check the deployed scheduler policy and test each intended trigger.

Choose one owner for requesting retries. If both a workflow engine and an application submit replacement jobs, a single failure can create duplicate experiments. Bound retries and distinguish a transient node failure from a reproducible input, permission or code error.

Persist retry decisions outside disposable local storage when the policy needs to survive node loss. Include the triggering reason and checkpoint generation in the attempt record. An administrator should be able to stop the loop without deleting the scientific output.

## Prove continuation on another node

Start with a small run whose progress and outputs are easy to inspect. Save a checkpoint, stop the attempt through a controlled test, and restore it on another qualified node. Confirm that progress continues from the saved point, configuration matches, and the application does not duplicate completed output.

Then test an incomplete newest checkpoint, a missing component, an incompatible executable and unavailable storage. Each should produce a specific result rather than a fresh run disguised as recovery. Keep a successful checkpoint while testing failure paths.

The acceptance question is concrete: after an interrupted allocation, can the next allocation recover the intended experiment, and can someone explain the amount of work lost? A job returning to `RUNNING` answers only the scheduling half.
