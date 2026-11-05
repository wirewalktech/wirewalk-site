---
title: "Node-local scratch under Slurm: stage data without losing the result"
date: "2026-10-23 10:00:00 -0400"
category: "Research Infrastructure"
tags: ["Slurm", "NVMe", "Storage", "Data Integrity", "Workflow Design"]
summary: "Design a node-local staging workflow with capacity checks, immutable inputs, bounded transfers, transactional result publication and explicit recovery after interruption."
seo_title: "Slurm Node-Local Scratch: Staging Data and Saving Results"
description: "Use node-local NVMe with Slurm through checked staging, capacity budgets and atomic result publication, with a recovery plan for interrupted jobs."
---

Local NVMe is a good place to avoid repeated shared-filesystem reads and hold temporary work. It is a poor place for the only copy of a completed result. A reboot, reimage or cleanup can remove that result before anyone notices it was never published.

Give the job separate states for staged inputs, completed computation and validated publication to project storage. After interruption, an operator should be able to identify which of those stages finished.

The paths and sizes below are examples. Test the publication procedure against the actual filesystem guarantees and the failures it needs to survive.

## Define the lifetime of each copy

Treat the original input, staged working copy, temporary output and published result as different objects. Assign an owner and retention policy to each. A successful stage-in does not authorize deletion of the source, and a successful computation does not authorize deletion of the local result before publication is verified.

Decide what failure the workflow must survive. A local cache can survive a process restart while still being lost with a node. If the scientific work cannot tolerate that loss, the application needs an appropriate checkpoint or result-publication strategy during execution.

Document whether the workflow is single-node or distributed. A shared path that looks identical on every node may actually name separate local disks. A multi-node job needs per-node staging and output ownership; one batch-shell copy command does not automatically operate on every host.

## Budget peak temporary space

Estimate input bytes, expanded data, working files, output, transfer staging and reserve headroom. Include inodes as well as bytes. Compressed input can expand substantially, and a pipeline may retain both packed and unpacked representations during processing.

For a simple capacity estimate, suppose a task stages 80 GiB of input, creates 120 GiB of working state and produces 30 GiB of output. That is at least 230 GiB before transfer overlap and safety margin. These are illustrative quantities, not measured workload characteristics.

Test at the intended number of concurrent jobs per node. Free space observed before one job starts is not a reservation against later jobs. Use the site's supported scratch-allocation mechanism where available, and define how competing jobs are prevented from consuming one another's budget.

## Use a job-specific namespace

A generic path such as `/local/scratch/work` invites collisions and cleanup mistakes. Allocate a directory tied to the job and, where necessary, array task and node identity. Verify that it belongs to the invoking user before writing.

```bash
# Illustrative setup inside a scheduled job.
: "${SLURM_JOB_ID:?Run within a Slurm allocation}"
: "${LOCAL_SCRATCH:?Set the site-approved scratch root}"
work=$(mktemp -d "${LOCAL_SCRATCH%/}/job-${SLURM_JOB_ID}.XXXXXX")
printf 'Working directory: %s\n' "$work"
```

The scratch root is supplied by site policy, not guessed by the script. Do not replace a failed allocation with an automatic fallback to the home directory. That converts a local-capacity issue into unplanned load on shared storage.

Retain a small manifest that links the local directory to the job, input version and intended destination. Keep sensitive filenames and credentials out of broadly visible logs.

## Stage an immutable input version

Use an explicit input manifest or snapshot identity. If files can change while copying, a checksum taken after the transfer does not necessarily identify the source state used by the application. Establish the input's consistency boundary first.

Stage into a temporary namespace, validate expected files and checksums, then mark the local copy ready. A directory existing on disk is not a readiness signal. The application should begin only after the full declared input set passes validation.

Slurm's [sbatch documentation](https://slurm.schedmd.com/sbatch.html) notes that it transfers the batch script rather than automatically moving the user's data files. Staging is part of the workflow that the site or application must provide and account for.

## Bound transfer concurrency

Stage-in can become a synchronized burst when many nodes start together. Limit concurrent readers and avoid having every task independently copy the same dataset. Where appropriate, stage once per node and let local tasks share a validated read-only copy.

Measure total startup time, shared-storage load and interference with other workloads. A local execution phase that becomes faster can still produce a slower overall workflow if staging dominates the allocation.

Separate reusable cache content from job-owned work. A cache needs immutable keys, completeness markers, locking and eviction rules. Without those, two jobs can mistake a partially populated cache entry for a valid input dataset.

## Publish complete generations

Write each result generation into a new destination rather than overwriting the current result while copying. The generation should include output files, a manifest, application identity and validation status. Readers should select only generations that satisfy the completion protocol.

A same-filesystem rename can provide atomic namespace replacement, as described in [rename(2)](https://man7.org/linux/man-pages/man2/rename.2.html). Moving between local NVMe and a shared filesystem is not that operation; it requires a transfer first. Tools may implement cross-filesystem moves as copy-and-delete.

For a custom publication protocol, transfer into a temporary directory on the destination filesystem, validate it, then publish a small manifest or pointer using the supported atomic mechanism. A multi-file result requires all participants to agree on what the published pointer means.

## Distinguish visibility from durability

A reader seeing a complete filename does not establish that the data will survive every failure. Linux [fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html) distinguishes file-data synchronization from directory-entry persistence. A shared filesystem adds its own guarantees and failure boundaries.

Do not turn a generic rename recipe into a universal durability claim. Review the storage system's documented semantics and test the interruption cases the research workflow needs to survive. Prefer a framework's supported transactional or checkpoint mechanism when it supplies the required guarantees.

Checksums establish byte agreement for the files checked. They do not establish scientific completeness. Validate expected record counts, dimensions, partitions or application invariants before advertising the generation as ready for downstream work.

## Plan for time limits and abrupt failure

Reserve time for publication rather than allowing computation to consume the entire wall-time request. Slurm supports advance signals under documented conditions; review the installed [sbatch signal options](https://slurm.schedmd.com/sbatch.html) and test which process receives the signal.

A signal handler may help an orderly exit, but it cannot guarantee recovery from power loss or an uncatchable kill. Long computations need periodic durable progress if restarting from the beginning is unacceptable.

Make publication restartable and idempotent. After interruption, a new attempt should distinguish an already validated generation from an incomplete transfer. Never infer success from a destination directory or from the fact that a previous copy process started.

## Clean up only after the correct evidence

Delete local state only after the durable destination is validated under the workflow's contract. If publication fails, retain enough metadata to locate the surviving copy and explain how long it will remain available. A node-local retention promise must match the actual cleanup and maintenance policy.

Test cancellation during stage-in, computation and stage-out using disposable data. Test a fresh allocation reading the published result without access to the original local disk. That is stronger evidence than validating output from the process that still has it cached.

Only mark the job complete when a fresh allocation can read and validate the published result without the original local disk. Researchers can then rely on the completion status even after the compute node is rebuilt.

Read next: [Storage Scale has free space, but the job cannot write: filesets, inodes and quotas](/writing/storage-scale-filesets-inodes-quota-troubleshooting/), [Distributed AI checkpoints: storage performance and restart testing](/writing/distributed-ai-checkpoint-storage-restart-testing/).
