---
title: "NVIDIA training cluster design: NVLink, InfiniBand, NCCL, and parallelism"
date: "2025-06-18 10:00:00-04:00"
category: "AI Infrastructure"
tags: ["NVIDIA", "NCCL", "NVLink", "InfiniBand", "ConnectX"]
summary: "Map distributed training onto NVIDIA GPU servers using a memory ledger, NVLink and PCIe topology, ConnectX and InfiniBand placement, NCCL transport evidence, and recoverable sharded checkpoints."
description: "Map distributed training onto NVIDIA GPU servers using a memory ledger, NVLink and PCIe topology, ConnectX and InfiniBand placement, NCCL transport evidence, and recoverable sharded checkpoints."
---

A distributed training cluster is a topology, not a GPU count. Communication within an NVLink-connected GPU group, across PCIe, and between nodes through network adapters has different costs. Parallelism choices determine how often the job pays each cost.

Design the NVIDIA server and fabric around the intended model decomposition. The objective is an allocation that fits the state, supplies data, communicates efficiently, and restarts predictably. Adding devices without checking those paths can increase both cost and step time.

## Map the physical paths to the parallel groups

Inventory GPU-to-GPU connectivity, CPU sockets, PCIe switches, NIC placement, link speeds, and storage paths. Distinguish GPUs connected through NVLink or an NVSwitch fabric from devices whose communication traverses PCIe. Record the exact server design; the interconnect is not implied by the GPU architecture name.

For inter-node communication, verify the installed ConnectX adapters, InfiniBand fabric, routing, firmware, and compatible communication software. An adapter link being up does not prove the training process uses RDMA. Record GPU-to-NIC affinity and rank placement so that a good test can be reproduced.

Place tensor-parallel groups on fast suitable paths because their intra-layer communication can be frequent. Choose data-parallel and pipeline boundaries using measured communication volume and stage balance. These are starting hypotheses to test, not an assumption that every model should use one fixed mapping.

## Prove the NCCL path before interpreting scale

[NCCL's archived 2.20 overview](https://docs.nvidia.com/deeplearning/nccl/archives/nccl_2205/user-guide/docs/overview.html) describes topology-aware GPU communication across NVLink, PCIe, InfiniBand, and sockets. NCCL is a communication library; it does not configure a healthy fabric or guarantee that the application selects the intended transport.

Capture library versions and a small diagnostic log from an isolated allocation. Confirm the selected interfaces and transport, then run a collective workload matching the application's participating devices and relevant message sizes. Compare single-node and multi-node behavior before changing model hyperparameters. Test one communication path at a time and preserve the logs rather than enabling verbose output indefinitely on a large run.

Finally, profile the actual training step. Good isolated collective bandwidth does not establish that communication is overlapped, that one rank is not starved by input, or that a pipeline stage is balanced. Qualify checkpoint writes and restart reads over the same fabric and storage system under representative concurrent load. The design must carry training and recovery traffic, not merely pass a standalone network benchmark.

## Write down the memory problem

Account for parameters, gradients, optimizer state, activations, temporary workspaces, and communication buffers. A model that cannot fit because of optimizer state needs a different intervention from one dominated by long-sequence activations.

Mixed precision changes several terms, often in different ways. An implementation may keep low-precision weights for computation, higher-precision optimizer state, and temporary buffers in another format. Do not infer the full footprint by multiplying parameter count by the weight storage type.

Measure peak memory at representative sequence length and microbatch size. Include a complete optimizer step, evaluation, and checkpoint operation. A forward-only estimate is not a training budget.

## Define the global batch precisely

For ordinary synchronous data parallelism, the global batch is the per-replica microbatch multiplied by the number of data replicas and the number of accumulation steps. Tensor-parallel and pipeline-parallel workers collaborate on a replica and do not each add an independent data batch.

Keep token count in view when sequences have variable lengths. Equal numbers of examples can represent very different amounts of data. Record the loss normalization rule, padding treatment, and the unit used by the learning-rate schedule.

When changing device count, decide whether global batch remains fixed. If it changes, throughput and convergence have changed together. Scaling efficiency alone cannot explain the resulting quality difference.

## Use data parallelism when replication fits

In synchronous data parallelism, replicas process different data and synchronize gradients. It is conceptually straightforward when each replica can hold the necessary training state.

Communication depends on gradient volume, collective implementation, and overlap with computation. Small microbatches can leave too little useful compute to hide synchronization. Many tiny gradient transfers can behave differently from fewer large transfers even when the total bytes are similar.

Inspect a training trace. Determine whether collectives wait for computation, computation waits for collectives, or both wait for the data loader. An isolated bandwidth test is useful, but it cannot establish whether the application's communication is overlapped successfully.

## Shard state to reduce redundant memory

State sharding distributes some combination of optimizer state, gradients, and parameters across data-parallel workers. The [ZeRO paper, first submitted in October 2019](https://arxiv.org/abs/1910.02054), describes eliminating memory redundancy in distributed training.

The memory saving is not free. The chosen sharding scheme determines what must be gathered or reduced and when. More aggressive sharding can create more sensitivity to interconnect bandwidth, latency, and the order in which modules execute.

Map the actual implementation rather than relying only on a stage label. Record the sharding group, materialized parameter sizes, prefetch behavior, and checkpoint format. A configuration that fits on a fast local fabric may perform poorly when the same group spans slower node boundaries.

## Keep tightly coupled tensor work close

Tensor parallelism partitions operations within layers. Workers repeatedly exchange intermediate results, so the communication path is part of the layer execution rather than an occasional end-of-step expense.

The [Megatron-LM paper, first submitted in September 2019](https://arxiv.org/abs/1909.08053), provides an early concrete implementation of intra-layer model parallelism for large language models. Its architecture is historical evidence for the method, not a performance prediction for a different cluster.

Prefer to place tightly coupled groups on the fastest suitable links where capacity allows. Verify actual GPU peer connectivity and NIC paths rather than assuming all devices in a node have equivalent access. Record the rank mapping so that another run can reproduce it.

## Use pipeline parallelism with enough work in flight

Pipeline parallelism places groups of layers on different workers and passes activations between stages. It helps distribute model capacity but introduces scheduling bubbles and stage imbalance.

Microbatches can keep several stages occupied. Too few leave devices idle; too many can increase activation pressure or scheduling overhead. The best arrangement depends on the schedule, stage boundaries, and model structure.

Balance stages using measured execution time and memory, not equal numbers of layers. Embeddings, output heads, and long-context operations can have different costs from a typical middle layer. Inspect the slowest stage across repeated steps.

## Test combinations with a controlled scaling matrix

Choose a small matrix of candidate layouts. For each, record device count, data replicas, tensor and pipeline groups, sharding scheme, microbatch size, accumulation, global batch, sequence length, useful tokens per second, and peak memory.

For a fixed workload, speedup is reference time divided by distributed time. Efficiency is speedup divided by the resource multiplier. Keep the comparison honest: a reference that uses a different precision, sequence length, or input pipeline cannot isolate parallelism effects.

Evaluate convergence at a matched training budget as well as short-run speed. A fast step that requires more steps to reach the target quality may have a higher total cost.

## Verify input distribution and recovery

Ensure each data replica receives the intended records. Check for accidental duplication across replicas and for incorrect sampler behavior after resume. Randomize deliberately, preserve seeds, and document any repeated or skipped samples at checkpoint boundaries.

Rehearse a worker failure in an isolated run. Determine whether the checkpoint can reload under the same topology and whether a changed device count requires conversion or is unsupported. A sharded checkpoint is not automatically portable to every serving or training arrangement.

Choose the simplest layout that fits, scales acceptably, and can be recovered by the operating team. A sophisticated parallelism diagram is useful only when its memory and communication assumptions survive measurement.
