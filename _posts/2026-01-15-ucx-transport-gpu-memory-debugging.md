---
title: 'UCX debugging: prove the transport, device and memory path used by the job'
date: 2026-01-15 10:00:00 -0500
category: Fabric
tags:
- UCX
- MPI
- RDMA
- NVIDIA GPUs
summary: Debug UCX from the installed build through MPI selection, device exposure and GPU-memory support, with
  bounded experiments and communication evidence from actual ranks.
seo_title: UCX Transport and GPU Memory Debugging for HPC
description: Troubleshoot UCX transport selection, RDMA devices, CUDA memory support and multi-rail behavior with
  controlled MPI tests and runtime evidence.
---

Seeing an RDMA adapter in `ucx_info` proves that the installed tool can discover it. It leaves several steps to check before a research job is qualified: the job must load the intended libraries, select the expected communication component and move the type of memory the application actually uses.

Those distinctions are especially useful when a CPU-buffer benchmark works but a GPU-buffer job fails, or when a host test performs well while the same executable inside a container takes a different path.

The reference stack here is **UCX 1.18.0**, released in January 2025, with **Open MPI 5.0.x** examples. Pin the actual build, providers and application image. Another MPI implementation can use UCX through a different integration and should be inspected through its own supported controls.

## Inventory the build the ranks will load

Collect tool, MPI and UCX identities in the environment used by the job:

```bash
command -v mpirun
command -v ompi_info
command -v ucx_info
ompi_info --param pml all
ucx_info -v
ucx_info -d
ucx_info -cf
```

The [UCX 1.18 tool source](https://raw.githubusercontent.com/openucx/ucx/v1.18.0/src/tools/info/ucx_info.c) documents these information modes. Keep the build and configuration output rather than relying only on the package label.

Repeat the observations on the participating nodes and, where relevant, inside the application container. A login-node tool can come from a different module tree. Even the expected executable path does not establish which shared libraries a launched rank ultimately loads.

Record loader paths, image digest, MPI component availability, GPU driver and the RDMA userspace stack. Keep this small enough to collect with a canary job after an image or module change. Do not publish environment dumps containing credentials or research paths as troubleshooting examples.

## Separate MPI component selection from UCX transport selection

Open MPI's [5.0.5 InfiniBand/RoCE guide](https://docs.open-mpi.org/en/v5.0.5/tuning-apps/networking/ib-and-roce.html) identifies the UCX PML as its InfiniBand/RoCE integration. The older `openib` BTL is absent from the 5.0.x series, so old recipes selecting it are not suitable for this baseline.

After that MPI boundary is established, UCX still chooses devices and communication protocols. A UCX-enabled MPI installation does not prove which eligible device a particular rank used.

For a two-node allocation, with one rank per node and a qualified host-buffer test executable, a bounded launch example is:

```bash
mpirun --mca pml ucx -x UCX_LOG_LEVEL=info \
  --map-by ppr:1:node -np 2 /opt/research/bin/host-buffer-canary
```

The executable is a placeholder for a tested application artifact, not a program supplied by this article. Run within the scheduler allocation and the site's supported MPI launch arrangement. Record rank-to-node mapping so a supposed inter-node test cannot silently become two local ranks.

Do not assume that an MPI test also qualifies a separate NCCL-based training path. Exercise the communication stack the real application uses.

## Prove eligible devices in the job's namespace

Compare UCX's device view with the host's RDMA devices, interfaces, addresses and topology. Confirm the intended port is active and the peers can reach the appropriate network.

A container may have an address without access to the required RDMA device, or a device allocation without the expected secondary network. The [Kubernetes multi-rail guide](/writing/kubernetes-multi-rail-rdma-gpu-setup-troubleshooting/) covers that allocation and attachment boundary.

If using `UCX_NET_DEVICES`, derive its value from the actual discovery output. An RDMA device/port name and a Linux Ethernet interface name are different kinds of selection. Identical-looking names on two hosts should still be checked against their physical mapping.

Begin with automatic selection and retain its evidence. Restricting the eligible set is a useful controlled experiment, but a restriction left in a shared environment can exclude devices required by another node class.

## Keep GPU-memory support when restricting transports

The [UCX 1.18 FAQ](https://raw.githubusercontent.com/openucx/ucx/v1.18.0/docs/source/faq.md) explains the roles of transport aliases and GPU-memory support. If an explicit `UCX_TLS` list is used for a CUDA-memory workload, include the appropriate CUDA transports. A network-only allow list can prevent correct handling of non-host pointers.

The same source distinguishes the `rc` alias from selecting only a specific low-level RC transport: bootstrap requirements still matter. Avoid reducing a working configuration to one guessed transport name and then treating initialization failure as a fabric outage.

Inspect CUDA-related capabilities in the actual job environment. Missing provider libraries, an incompatible loader path or an application built against a different stack can change the result even when the host has a healthy GPU driver.

Test host buffers first, then GPU buffers with a benchmark that actually allocates GPU memory. Record the buffer type, rank placement, message sizes and synchronization method. A benchmark with a GPU-themed name is not sufficient evidence that its measured buffers are on the GPU.

## Read selection evidence before interpreting bandwidth

Use temporary informational logging for the small reproduction. Capture the selected devices and protocol information from each rank, along with the loaded stack and message sizes.

For the protocol-v2 path in the pinned baseline, `UCX_PROTO_INFO=y` provides additional protocol-selection information. Check the installed configuration before enabling it and remove diagnostic settings after the investigation. Large-scale verbose logging can change behavior or obscure the first failure.

GPU-memory support also does not guarantee that every transfer uses direct GPU-memory RDMA. Message size, supported integration and platform topology influence the chosen path. Preserve the relevant peer-memory or DMA-BUF stack information rather than inferring direct access from an installed package alone.

Use the [GPUDirect Storage path-validation guide](/writing/gpudirect-storage-direct-path-validation/) as a related example of checking a selected data path. Storage and MPI exercise different software, so its results do not substitute for a UCX communication test.

## Change one communication boundary at a time

A useful test matrix keeps all but one variable fixed:

| Experiment | What it helps isolate |
|---|---|
| Same node versus two nodes | Local communication versus the inter-node path |
| Host buffers versus GPU buffers | General transport health versus GPU-memory handling |
| Automatic devices versus one verified device | Selection/locality versus an individual adapter path |
| Small versus larger messages | Different protocol behavior and transfer costs |
| One rail versus the qualified multi-rail layout | Additional path eligibility, locality and shared bottlenecks |
| Host environment versus the same container image | Device exposure and userspace compatibility |

Keep CPU binding and memory placement visible. A transport change made alongside a binding change is difficult to interpret. The [PCIe path investigation](/writing/pcie-aer-link-width-gpu-nic-diagnostics/) helps explain shared links and locality before attributing a result to UCX policy.

Do not use one successful small message as proof of large-transfer performance. Conversely, a large sequential bandwidth result says little about the latency and synchronization pattern of a small-message application.

## Investigate failures by their first unmet condition

If the MPI integration is unavailable, resolve the installed component and library stack before tuning UCX variables. If initialization fails only on one node, compare its device view and provider availability with the working node.

If a GPU-buffer case fails after host buffers pass, inspect memory-type support, loaded GPU components and the application buffer contract. The pinned FAQ documents a memory-type-cache workaround for a specific diagnostic situation; treat that as a targeted experiment, not a global setting to deploy without a reproduced cause.

If performance degrades only with more ranks, inspect shared PCIe paths, NUMA placement, transport resources and application progress. A single pair's result cannot establish behavior at the intended rank count.

Preserve the earliest rank failure. Later connection errors can be the consequence of that process exiting rather than independent network failures.

## Monitor useful communication and retain the qualified environment

Join job, rank, host, GPU identity, RDMA device and selected rail in the investigation record. Use bounded logs for detailed identities rather than permanent high-cardinality labels on every monitoring series.

Measure communication time and application progress together. Preserve counter deltas over the same interval, with reset events and competing load. A busy NIC does not prove that the job is moving the intended buffers efficiently.

Keep the working launch, image or module identity, configuration overrides and result matrix together. Re-run the small qualification after UCX, MPI, GPU-driver or node-image changes. A reproducible result gives the next investigator a known starting point and prevents a temporary workaround from becoming unexplained infrastructure policy.
