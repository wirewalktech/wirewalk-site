---
title: "GPU utilization is not utilization: reading MFU without fooling yourself"
category: Benchmarking
tags: ["GPU", "H100", "MFU", "nvidia-smi", "DCGM", "LLM Training", "AI Infrastructure", "Performance"]
summary: >-
  nvidia-smi reporting 100% means a kernel was resident, not that the tensor
  cores did useful work. Model FLOPs utilization is the honest number, and a
  mid-thirties result on a real training run is normal rather than alarming.
description: "Why nvidia-smi utilization misleads for GPU training, how to compute model FLOPs utilization (MFU), what a realistic MFU looks like, and which bottleneck each symptom points to."
date: "2026-09-18"
last_reviewed: "2026-10-17"
series: "HPC and AI infrastructure engineering"
---

A researcher reports their training job is running at 100% GPU utilization and asks for more
GPUs. The number is accurate and it does not mean what it is being used to mean.

## What nvidia-smi's utilization field measures

`utilization.gpu` is the percentage of the sampling interval during which **at least one kernel
was executing**. One kernel. It says nothing about how many SMs that kernel occupied, whether
the tensor cores were used, or whether the kernel spent its time waiting on memory.

A single-threaded kernel that reads one float per clock will report 100% utilization while
delivering a rounding error of the device's capability.

```bash
nvidia-smi --query-gpu=utilization.gpu,utilization.memory,power.draw,clocks.sm \
           --format=csv -l 5
```

Two cross-checks available right there, and both are more informative than the utilization
field:

- **Power draw.** A device doing dense tensor work sits near its board limit. A device reporting
  100% utilization at a third of its power limit is not doing dense arithmetic. This is the
  single fastest sanity check available.
- **SM clocks.** Sustained work at well below the boost clock suggests thermal or power
  capping, which is a facilities answer rather than a code answer.

For anything beyond a spot check, use DCGM, which exposes occupancy and pipe activity rather
than a boolean "busy":

```bash
dcgmi dmon -e 1002,1003,1004,1005,1009,1010 -c 10
#        gr_engine_active, sm_active, sm_occupancy, tensor_active, ...
```

`DCGM_FI_PROF_PIPE_TENSOR_ACTIVE` is the one that answers the real question for training work:
what fraction of the time were the tensor cores issuing. It is routinely in the teens or
twenties on jobs whose `nvidia-smi` utilization reads 100%.

## Model FLOPs utilization

The honest metric for training is MFU: the arithmetic the model definition requires, divided by
what the hardware could theoretically deliver in the same wall-clock time.

For a dense transformer, forward and backward together, the standard approximation is

```
FLOPs per token ≈ 6 × N          (N = non-embedding parameter count)
```

with an attention term that matters at long context:

```
FLOPs per token ≈ 6N + 12 × L × H × S
    L = layers, H = hidden size, S = sequence length
```

Then

```
achieved  = tokens_per_second × FLOPs_per_token
MFU       = achieved / device_peak_dense_FLOPS / num_devices
```

The denominator has to be the **dense, non-sparse** figure for the dtype actually used. Vendor
headline numbers are frequently the sparsity-enabled value, which doubles it, and quoting MFU
against that halves your result for no reason. If you use bf16 tensor cores, use the bf16 dense
number.

A worked example, with figures that are illustrative rather than a product claim: a single
modern data-centre GPU running a parameter-efficient fine-tune delivering roughly **350 TFLOPS
of useful model arithmetic against a dense bf16 peak near 990 TFLOPS** lands at about **35%
MFU**.

That is not a problem to be fixed. For LLM training, well-tuned jobs commonly sit in the 35–50%
band; large, heavily engineered pretraining runs reach higher. A job at 35% MFU and 100%
`nvidia-smi` utilization is behaving normally. A job at 4% MFU and 100% utilization has a real
problem, and the utilization field cannot distinguish them — which is the entire argument for
computing MFU.

## What low MFU actually points to

| Observation | Bottleneck | Direction |
|---|---|---|
| MFU low, power draw low, tensor_active low | Memory-bound or launch-bound | fuse kernels, raise batch, check dtype |
| MFU low, power high | Doing arithmetic that is not model FLOPs | recompute/checkpointing overhead, padding waste |
| Throughput scales poorly past one node | Collective bandwidth or topology | measure allreduce separately |
| Large variance between steps | Data loading, or a straggler rank | time the loader; check per-rank step times |
| Good single-GPU MFU, poor multi-GPU | Communication not overlapped | overlap, gradient bucketing |
| MFU drops as context grows | Attention term now dominant | expected; use the full formula |

Padding deserves a line of its own because it is invisible in every utilization metric. If
sequences are padded to a fixed length and the real distribution is much shorter, a large share
of the arithmetic is performed on padding. The GPU is genuinely busy, the tensor cores are
genuinely active, and a meaningful fraction of the work is on tokens that do not exist. Sequence
packing or length bucketing recovers it, and the before/after shows up in tokens per second
while `nvidia-smi` does not move at all.

## Measure the collective separately before blaming the model

When scaling stops, the question is whether the fabric or the code is at fault, and that is
answerable directly:

```bash
# bus bandwidth across the devices you will actually train on
./build/all_reduce_perf -b 8 -e 8G -f 2 -g <gpus>
```

Read the **busbw** column, not algbw, and compare against the link capability for the path those
devices take. If the collective achieves close to the fabric's capability and your training step
does not improve when you overlap communication, the bottleneck is compute. If the collective is
far below, fix that first — no amount of model-side tuning compensates for a collective running
over the wrong transport.

Two specifics worth checking in that order: that the job is using RDMA and has not fallen back
to TCP, and that multi-rail devices are actually both in use rather than one adapter carrying
everything.

## Out-of-memory is usually not the model

A 49-billion-parameter fine-tune that OOMs on hardware that should hold it is normally an
accounting problem rather than a capacity one. The usual contributors, in the order they are
worth checking:

- Optimizer state in fp32 at 8 bytes per parameter, which dwarfs the weights.
- Activation memory, which scales with batch × sequence and is often the actual consumer.
- Sharding configured for parameters but not optimizer state or gradients.
- A tokenizer or dataloader pinning host memory that then cannot be used for staging.
- Fragmentation from varying sequence lengths, which looks like a smaller device than you have.

Before changing the model, print the allocator's own summary. `torch.cuda.memory_summary()`
attributes memory to categories, and the category that is unexpectedly large is the answer.

## Reporting a GPU result so it can be checked

1. State tokens per second **and** the MFU, with the peak figure and dtype you divided by.
2. State whether the peak used was dense or sparsity-enabled.
3. State sequence length and whether sequences were packed or padded.
4. State device count and whether the number is per device or aggregate.
5. Give the window. A step-time average over ten steps after warmup is a different number from
   one taken across the first ten.

A result reported this way can be reproduced and argued with. "100% GPU utilization" cannot be,
and it is the number most often used to justify buying more hardware.

**Utilization answers "is the device busy". MFU answers "is the device useful".** Only one of
those is a capacity planning input.
