---
title: "Distributed training parallelism: match memory and communication to topology"
date: "2025-06-18 10:00:00-04:00"
category: "AI Infrastructure"
tags: ["Distributed Training", "Data Parallelism", "Model Parallelism"]
summary: "How to choose data, tensor, pipeline, and state-sharded parallelism using a memory ledger, global batch definition, communication profile, topology map, and checkpoint recovery requirements."
description: "How to choose data, tensor, pipeline, and state-sharded parallelism using a memory ledger, global batch definition, communication profile, topology map, and checkpoint recovery requirements."
---

Adding GPUs introduces two separate questions: can the model fit, and does the training run become more efficient? A configuration can solve the first while making the second worse. The right parallelism strategy follows the memory footprint, communication pattern, and available topology.

Begin with a working single-device or smallest feasible reference. Preserve its loss behavior and useful throughput so that a distributed run can be compared against something more meaningful than aggregate GPU activity.

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
