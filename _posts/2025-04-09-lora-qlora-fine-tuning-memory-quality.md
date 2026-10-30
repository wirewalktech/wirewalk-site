---
title: "LoRA and QLoRA fine-tuning: memory budgets, adapters, and quality controls"
date: "2025-04-09 10:00:00-04:00"
category: "AI Infrastructure"
tags: ["LoRA", "QLoRA", "GPU Memory", "Fine-Tuning"]
summary: "A practical adapter fine-tuning plan that distinguishes trainable parameters from total memory, budgets activations and checkpoints, tests data masking, and validates the final serving artifact."
description: "A practical adapter fine-tuning plan that distinguishes trainable parameters from total memory, budgets activations and checkpoints, tests data masking, and validates the final serving artifact."
---

Adapter fine-tuning can make a useful experiment possible on hardware that cannot support a full parameter update. It can also create a misleading capacity estimate: a small adapter file does not mean the complete training job needs little memory.

The base model still participates in computation. Activations, temporary buffers, sequence length, and the implementation of quantized operations all matter. Plan the run as a complete system, then verify quality on the artifact that will actually be served.

## Understand what is updated

LoRA represents an update to a weight matrix using two smaller matrices. For a matrix with dimensions d by k, an adapter rank r introduces approximately r times the sum of d and k trainable parameters, instead of d times k for a full update to that matrix. The base weights remain frozen.

The [LoRA paper was first submitted in June 2021](https://arxiv.org/abs/2106.09685). Its central contribution is a low-rank adaptation method, not a universal claim that every task needs the same rank or that every layer should receive an adapter.

QLoRA, [submitted in May 2023](https://arxiv.org/abs/2305.14314), combines a frozen quantized base with trainable low-rank adapters. The paper describes NF4, double quantization, and paged optimizers. A four-bit base representation does not imply that every intermediate, adapter, gradient, or optimizer state is stored in four bits.

## Build a memory ledger

List persistent and transient allocations separately. The persistent portion includes base weights, quantization metadata, adapters, adapter gradients, and optimizer state. The transient portion includes activations, attention workspaces, temporary dequantized values, communication buffers where applicable, and framework overhead.

As an illustrative lower-bound calculation, seven billion parameters at four bits occupy 3.5 billion bytes before metadata and other allocations. That is about 3.26 GiB. It is not a complete estimate of whether a seven-billion-parameter training job fits on a particular device.

Sequence length and microbatch size can change the activation budget dramatically. Measure representative long sequences, not just a batch of short examples. Keep memory headroom for evaluation and checkpoint operations, which may follow different allocation paths from steady-state training.

Record allocated and reserved memory as different observations. A framework allocator retaining memory is not automatically a leak; growth across repeated identical steps deserves investigation.

## Choose adapter placement with an experiment

Identify the modules receiving adapters and verify that their names match the actual model architecture. A configuration copied from another model can target the wrong components or none at all.

Print the trainable parameter count and inspect several named parameters. Confirm that base weights are frozen and intended adapter weights receive gradients. Run a tiny update and check that adapter values actually change.

Treat rank, scaling, dropout, and target modules as experimental choices. A higher rank increases flexibility and cost, but improvement is task dependent. Compare a small number of justified configurations under the same data and evaluation budget before expanding the search.

Keep a full fine-tuning comparison only when resources and the project question warrant it. The useful decision is whether the adapter meets the task requirement, not whether one method wins every possible benchmark.

## Verify tokenization and loss masking

Inspect decoded examples after the complete formatting path. Confirm role markers, separators, end tokens, truncation behavior, and which tokens contribute to the loss. A plausible-looking text file can become a very different training sequence after templating.

For supervised response training, decide whether the task should train on prompt tokens, response tokens, or another explicit span. Verify masks numerically and visually on a few examples. An answer truncated away by the maximum length can leave a record with no useful supervised target.

If packing multiple examples into a sequence, verify boundary and attention behavior for the implementation in use. Count useful supervised tokens as well as total processed tokens. Otherwise padding or masked prompt text can make a throughput result look more productive than it is.

Use validation examples from sources not represented by near duplicates in training. Adapter efficiency does not protect against data leakage.

## Tune the optimizer using measured behavior

Start with a conservative task-appropriate configuration and a short run. Track training loss, held-out quality, gradient behavior, and output examples. A decreasing training loss is not sufficient evidence of useful adaptation.

Gradient accumulation increases the effective batch without requiring the same activation memory as a single larger microbatch, but the run still needs to preserve the intended loss normalization and update schedule. Record both microbatch size and effective batch size.

Activation checkpointing trades recomputation for memory. Offloading trades device pressure for host memory and transfer cost. Paged optimizer behavior can depend on memory pressure. Measure these choices on the intended hardware instead of assuming a configuration that fits will also train efficiently.

## Save a reproducible adapter bundle

An adapter needs the exact compatible base revision, tokenizer, formatting template, adapter configuration, and runtime assumptions. Preserve those identifiers with the adapter weights. A base model family name does not identify a particular set of parameters.

For training continuation, retain optimizer and scheduler state in addition to the adapter. For deployment, retain the input contract and generation settings used during evaluation. Distinguish these two purposes so that a minimal serving export is not mistaken for a resumable checkpoint.

Hash important artifacts and test loading them in a clean environment. Document any custom code required by the loader and review it as executable software.

## Evaluate the serving representation separately

Serving with an adapter, merging into higher-precision base weights, and quantizing a merged model are different artifact paths. Numerical behavior and runtime support can differ. Validate the final path using held-out task cases, general regression cases, long inputs, and invalid-input handling.

Measure quality and latency together. If a merged version removes adapter overhead but damages a critical slice after quantization, a smaller file is not sufficient justification for promotion.

Publish a result with base revision, adapter placement, rank, data version, supervised-token policy, context length, hardware, peak memory, runtime, and evaluation outcome. Such a record tells another engineer what was demonstrated. “Fine-tunes on one GPU” leaves almost every important condition unstated.
