---
title: 'Slurm job arrays: choose concurrency by completed work and filesystem pressure'
date: 2026-03-18 10:00:00 -0400
category: HPC Operations
tags:
- Slurm
- Parallel analysis
- Storage
- Linux
summary: Control array concurrency, input discovery and result publication so large parameter sweeps finish predictably
  without overwhelming shared metadata services.
seo_title: 'Slurm Job Arrays: Concurrency, Metadata and Reliable Output'
description: Tune Slurm job arrays using completed-work rates, stable input manifests, metadata pressure and selective
  retries instead of maximum task counts.
---

A parameter sweep can run thousands of tasks and still finish more slowly after its concurrency limit is raised. The tasks may spend their additional time opening files, importing the same environment or waiting for a metadata service that every worker reaches at once.

Arrays simplify submission and identification. They do not remove the cost of starting processes or accessing shared storage. The practical unit to optimize is a completed input with a valid output, including the time spent recovering failures.

## Make the task index refer to a stable input

Create an input manifest before submission. Give each work item a durable identifier and preserve the exact manifest with the run. Sorting a directory independently inside each task is unsafe when files can be added or renamed while the array runs.

For a modest manifest, a line-number lookup can be enough. For a very large one, repeatedly scanning from the start becomes wasteful; use a precomputed index or a representation that supports direct access. Avoid putting executable shell fragments in the manifest. Treat parameters as data and pass them as separate arguments.

[Schematic array submission](https://slurm.schedmd.com/job_array.html) can use a concurrency limit:

```bash
#!/bin/bash
#SBATCH --array=0-999%24
#SBATCH --cpus-per-task=1
#SBATCH --mem=2G
#SBATCH --time=00:20:00
#SBATCH --output=logs/%A_%a.out
set -euo pipefail
python worker.py --manifest inputs.jsonl --index "$SLURM_ARRAY_TASK_ID"
```

Here, 1,000 tasks and a limit of 24 are illustrative choices, not recommended defaults. The `logs` directory must exist before the job starts. The worker must validate that its index resolves to one intended record and write an output associated with that record.

## Measure what happens before computation

Break task duration into environment setup, input discovery, data reads, computation and publication. A task that computes for two seconds after importing packages for twenty deserves a different execution design from a simulation that runs for two hours.

Collect a few representative task timelines instead of tracing every filesystem operation from every worker at once. Diagnostic logging can itself overload the service under investigation. Record enough timestamps to identify whether the delay is at startup, steady state or shutdown.

Check the directory layout. A large array creating several files per task in one shared directory can turn publication into a queue of metadata operations. Shard output directories by a stable work-item key when appropriate. A directory per task can also become expensive, so measure the total object count rather than assuming more directories solve everything.

## Sweep concurrency over complete runs

Hold input, environment and resource requests constant. Compare several bounded concurrency settings. Measure accepted outputs per minute, elapsed completion time, failure rate and storage-side latency where available. Watch impact on other users as well as the array itself.

A hypothetical test might find 12 tasks complete 30 items per minute, 24 complete 49, and 48 complete 45 while metadata latency rises. That supports investigating the 24-task region; it does not establish a universal optimum or prove that storage is the only constraint.

Use enough work to get past cache warming and stagger effects. Repeat selected points and retain the distributions. A single fast run after a slow run can simply be the second run benefiting from already-read inputs.

## Batch tiny work without hiding failures

If startup dominates, process a bounded group of inputs within one task. Keep resource requests and wall time honest. The task should record completion for each item so an interruption does not force the whole group to be treated as lost.

There is a trade-off: larger groups amortize startup but make scheduling less flexible and increase the work affected by a failed attempt. Use measured item-duration variation to choose the group size. A fixed count can be a poor fit when one item takes a hundred times longer than another.

Do not have each task repeatedly query the scheduler to decide whether it may continue. The array's concurrency control already provides a useful bound. If another shared resource needs admission control, implement that at an appropriate service boundary rather than flooding the controller with polling.

## Publish results that retries can recognize

Use a unique temporary destination for an attempt, validate the result, and publish it under the work item's stable identifier. A file's existence is not a completion test. Check its expected structure, input identity and relevant version information.

Retries should distinguish a valid existing result from a partial one. Decide how concurrent attempts are prevented or reconciled; a blind overwrite can replace a successful result with a failed attempt's output. For shared POSIX storage, review the atomicity and durability properties of the chosen publication operation.

Keep failure categories separate. Input validation errors need correction, not more attempts. Transient service errors may deserve bounded retry. An out-of-memory task needs investigation of its actual resource demand before being sent through the same limit again.

## Close the run with reconciliation

Compare the manifest with validated outputs. Account for every intended work item as completed, failed with an explanation or deliberately excluded. Scheduler success is useful execution evidence, but it does not establish that the worker processed the correct item or produced scientifically usable data.

The [sbatch reference](https://slurm.schedmd.com/sbatch.html) documents array syntax and filename substitutions. Keep those mechanics separate from the application's completion rules. Once the result ledger is reliable, selective retries become straightforward and a large sweep stops depending on someone visually inspecting thousands of log files.

For wider data-processing bottlenecks, see [parallel analysis, skew and shuffle](/writing/parallel-data-analysis-skew-shuffle/).
