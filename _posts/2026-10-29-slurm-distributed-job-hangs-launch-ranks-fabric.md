---
title: "A distributed Slurm job is running but making no progress: a debugging sequence"
date: "2026-10-29 10:00:00 -0400"
category: "HPC Operations"
tags: ["Slurm", "MPI", "NCCL", "RDMA", "Distributed Training"]
summary: "Separate allocation, process launch, rendezvous, communication and application progress when a distributed MPI or NVIDIA GPU workload appears to hang."
seo_title: "Slurm Job Hangs: MPI, NCCL and RDMA Troubleshooting"
description: "Trace stalled Slurm MPI and NVIDIA training jobs through process launch, rendezvous, rank failure, RDMA transport and application progress."
---

GPUs are allocated and processes are alive, but the distributed job has stopped printing progress. Before trying another MPI or NCCL setting, find out how far each rank got. One missing worker can leave all the others waiting.

Check task launch, process-manager initialization, rendezvous, transport setup and the first collective in order. The last completed stage narrows the investigation without changing several parts of the stack at once.

This sequence applies to generic Slurm-managed MPI and NVIDIA GPU workloads. The exact launcher and diagnostics depend on the installed MPI, PMIx, framework and NCCL versions. All job IDs and node descriptions are illustrative.

## Define progress in application terms

Ask what the workload should have completed by now: initialization of all ranks, reading a first input shard, a simulation timestep, a training iteration or a checkpoint. A process consuming CPU is not necessarily making useful progress. It may be polling while another process waits on storage.

Capture the job ID, allocated nodes, start time, task layout, image digest and launch command. Keep the original logs before adding diagnostics. Record whether output is buffered and whether a progress line is printed only by rank zero.

If only one process writes progress, a silent log cannot distinguish a healthy long-running operation from a lost worker. Add bounded per-rank startup records in the next reproduction rather than assuming every rank reached the same point.

## Prove the launch layer first

Within a small allocation, run a hostname step using the intended task layout:

```bash
srun --ntasks=4 --label hostname
srun --mpi=list
```

The first command tests basic task placement and launch. It does not test MPI. The second reports available Slurm MPI plugins; it does not prove compatibility with the application image.

Use the [Slurm MPI guide](https://slurm.schedmd.com/mpi_guide.html) to choose the supported launch model. Avoid wrapping one launcher inside another without understanding the process tree. `srun mpirun ...` can create multiple launchers if every Slurm task executes the command, multiplying ranks and confusing failure reports.

Do not repair a launch problem by allowing arbitrary SSH fanout. That may start processes outside the accounting, binding or cleanup path the site intended to enforce.

## Establish every rank's identity

For the reproduction, emit hostname, process ID, rank, local rank and intended world size once per process. Use the rank variables defined by that launch model. Slurm task IDs and framework ranks may coincide in one configuration and differ in another.

Verify that every expected rank appears exactly once. Check that each GPU worker is assigned the intended device and that no local rank accidentally selects an unallocated GPU. Compare GPU UUIDs rather than assuming visible index zero identifies the same physical device everywhere.

A missing rank is a launch or early-exit investigation. Duplicate ranks suggest a topology or launcher error. A complete, consistent rank set allows the next test to focus on initialization and communication rather than task creation.

## Separate rendezvous from the data path

Distributed frameworks may use a TCP rendezvous endpoint before using another transport for bulk collectives. A reachable rendezvous port therefore does not establish a working RDMA path. Equally, healthy RDMA hardware cannot compensate for ranks resolving different rendezvous addresses.

Record the selected rendezvous name, resolved address, port, world size and per-process rank assignment. Check address resolution from each participating node using the same environment as the workload. Avoid selecting the first interface returned by a hostname command on a multihomed machine.

If the endpoint is chosen dynamically, confirm that every rank receives the same value and that another job is not using it. Keep credentials and tokens out of the diagnostic log. A minimal initialization-only application is more useful here than immediately loading a large model and dataset.

## Read all ranks before blaming the collective

A collective can wait because one participant never reached it. Search every rank's log for the earliest exception, input error, GPU memory failure or process termination. A rank still running can be waiting for a peer that exited minutes earlier.

Use Slurm's [step accounting](https://slurm.schedmd.com/sacct.html) and application logs together. A process exiting nonzero may be the cause, while communication errors elsewhere are consequences. Retain exact timestamps and avoid interpreting merged output order as an exact distributed timeline.

For a small reproduction, configure a finite application timeout and an expected failure response. Do not leave diagnostic allocations indefinitely occupying GPUs because the test has no deadline.

## Narrow the communication boundary

Progress from one process to multiple processes on one node, then two nodes, then the intended scale. Keep the executable, image and message sizes consistent where possible. The transition that introduces the failure is evidence.

For NVIDIA collectives, a bounded diagnostic environment can include:

```bash
export NCCL_DEBUG=INFO
export NCCL_DEBUG_FILE='nccl.%h.%p.log'
```

These variables are documented in the [NCCL environment reference](https://docs.nvidia.com/deeplearning/nccl/archives/nccl_2243/user-guide/docs/env.html). Use a job-specific output directory on a writable filesystem. Large debug logs can themselves create an I/O problem; retain them for the reproduction rather than enabling verbose logging indefinitely for all jobs.

Read which transports and interfaces were selected. Do not infer RDMA use merely because InfiniBand is installed. Compare container and host visibility of network devices and required libraries, and examine the site's approved low-level communication tests before changing application tuning.

## Use fallback as an experiment

Temporarily selecting a different supported transport can help isolate a fault. If a small job works with a TCP path and fails with RDMA, the difference narrows the investigation. It does not prove a particular cable, library or driver is defective.

Record the exact setting, its scope and how it is removed. A diagnostic fallback should not quietly become the production default because the run finally completed. That can leave expensive hardware unused while the infrastructure appears repaired.

The same discipline applies to network-interface exclusions, shared-memory settings and GPU peer-to-peer controls. Each knob should test a hypothesis. Changing several at once produces a result that is difficult to explain and harder to maintain.

## Check storage and CPU pressure before declaring a network hang

One rank waiting for an input shard can hold every other rank at a collective. Compare per-rank input progress, storage latency, CPU binding and data-loader activity. High GPU utilization can also include waiting or communication behavior that does not advance the scientific workload.

Look for oversubscribed CPU workers, constrained memory, full temporary storage and a single slow input partition. Use a synthetic in-memory workload to separate compute/communication from the input pipeline, then restore representative I/O.

For MPI, check whether the application makes the progress calls expected by its communication pattern. An application-level deadlock and a transport failure can look similar from the scheduler. A small, instrumented reproducer helps the application team and infrastructure team work on the same evidence.

## Close at the scale that mattered

A two-node success does not establish a full allocation is healthy. After fixing the isolated fault, rerun at the scale and placement that exposed it, with representative input and an explicit completion condition.

Save the launch model, versions, selected interfaces, task mapping, elapsed initialization time and application outcome. Confirm every intended participant joined, communication used the expected path and the workload resumed measurable progress.

Read next: [Apptainer, MPI and RDMA: make the host–container boundary explicit](/writing/apptainer-mpi-rdma-host-container-compatibility/), [An MPI troubleshooting playbook: symptom to cause](/writing/mpi-troubleshooting-playbook/).
