---
layout: resource
title: How the BCM 11 cluster simulator works
seo_title: BCM 11 Simulator Model, Scenarios and Assumptions
description: Understand the Wirewalk cluster simulator’s provisioning states, eight GPU rails, bonded access, Lustre and GPFS models, commands and explicit limits.
parent_url: /lab/cluster-simulator/
parent_title: Cluster simulator
nav_section: lab
eyebrow: Model and operating guide
---

[Open the interactive cluster lab](/lab/cluster-simulator/).

## Build the cluster you want to investigate

Choose Spectrum-X/RoCE or InfiniBand for east–west traffic, LACP or active–backup for the two-member north–south bond, and Lustre or GPFS/IBM Storage Scale. Select 2–128 compute nodes, with eight virtual GPUs and eight rail ports per node. A seed makes the same actions and clock ticks reproducible.

This is an independent educational model of selected BCM 11 workflows. It runs a JavaScript state engine in an isolated hosted account session. The browser displays the server state. It does not install NVIDIA software, start virtual machines, contact a cluster, connect to production infrastructure or implement the complete BCM command/API surface. No BCM license is supplied or exercised. The interface is Wirewalk’s own design.

## Separate the three network roles

| Path | Role in this model | Failure behavior |
|---|---|---|
| Management/PXE | Head roles, provisioning and new scheduling | Provisioning/scheduling wait; already running compute can continue |
| East–west | Eight GPU/HCA rails per compute node | A rail interruption fails an active job under this conservative transport model |
| North–south bond | Client/input access and the storage client path | One member may retain access; total loss blocks staging, checkpoints and result publication |

GPU0 normally maps to rail 1, through GPU7 on rail 8. The mismatch scenario swaps the first two associations on the selected node. This illustrates physical identity and placement checks; it does not reproduce a specific server’s PCIe/NVLink topology, routing algorithm or NCCL rail selection.

The assumed per-port rail rate is 400 or 800 Gb/s. Link capacity, traffic counters and utilization are synthetic. The [NVIDIA reference architecture](https://docs.nvidia.com/dgx-superpod/reference-architecture/scalable-infrastructure-b300-xdr/latest/dgx-superpod-components.html) provides an example of rail-optimized GPU fabrics; physical designs can use different node/rail/plane arrangements.

For the NS model, each member is 100 GbE. LACP has a modeled 200 Gb/s aggregate with both members, assuming compatible switch configuration and multiple suitably distributed flows. A single flow remains bounded by one 100 Gb/s member. Active–backup is bounded by the active member even when both are healthy. Hashing, packet timing and LACP negotiation are not simulated. See the [Linux bonding documentation](https://docs.kernel.org/networking/bonding.html).

## Follow provisioning and readiness separately

The model uses a finite progression: queued → BOOTING → INSTALLING → INSTALLER_CALLINGINIT → UP. Provisioning slots limit the concurrent boot/install set, and a locked image defers a request. Management loss stalls that path. Durations are short teaching values, not expected installation times.

BCM documents the boot/install/handover states and defines UP in terms of node-daemon connectivity in its [provisioning manual](https://docs.nvidia.com/base-command-manager/product-manuals/11/admin/provisioning). In this lab, an UP daemon is only one condition. Scheduler readiness additionally requires an installed target image, modeled GPU stack, healthy GPU state, expected rail mapping, all eight EW rails, a mount and no operator drain.

That readiness policy is a Wirewalk teaching rule, not a claim that BCM automatically applies these exact scheduler gates. A drained node can finish an existing allocation. Reimage is refused while a node remains allocated.

## Treat images as separate installed copies

The starting `gpu-v1` image is assumed prepared. `gpu-v2` deliberately lacks the modeled GPU stack. Preparing the image changes its template; it does not modify copies already installed on nodes. Reimage an idle canary, check its readiness, promote the category, then roll two idle nodes at a time. Reimaged nodes remain drained until an explicit check-and-resume succeeds.

Promotion changes the desired image and flags a difference from an installed copy. It does not silently reimage the fleet. Image compatibility is reduced to a small teaching gate: no actual kernel module, firmware, ABI or driver qualification is performed.

The [BCM 11 release overview](https://docs.nvidia.com/base-command-manager/bcm-11-release-notes/overview.html) notes that CUDA driver and MOFED packages are no longer distributed in BCM repositories. The [software-image manual](https://docs.nvidia.com/base-command-manager/product-manuals/11/admin/softwareimagemanagement) explains image management. This simulator models deliberately preparing a stack rather than treating those packages as automatically provided.

## Know the storage assumptions

**Lustre:** four virtual services represent a metadata HA pair and two OSS/OST groups. Metadata failover assumes a shared target and correct fencing; the role transfer takes three logical ticks. Those mechanisms are assumed, not executed. OSS failover is not configured here, so an unavailable OST group blocks the modeled striped workload. Real Lustre layouts, mount recovery and failover policies need their actual design. See the [Lustre operations manual](https://doc.lustre.org/lustre_manual.xhtml).

**GPFS/IBM Storage Scale:** there are four virtual storage services. Services 1–3 vote for node quorum, with two required. Data group A has copies on services 1/2; group B on 3/4. Every group needs an available copy as well as quorum. These fixed placements are simplified failure-group assumptions; they do not implement NSD ownership, disk quorum/tiebreakers, recovery protocols or real data replication. The [IBM quorum documentation](https://www.ibm.com/docs/en/storage-scale-ece/6.0.0?topic=roles-quorum-nodes) explains the majority concept.

These are intentionally visible, different redundancy configurations. Their simulated outcomes do not establish that one filesystem is faster or more reliable than the other. Neither model stores real data or verifies integrity, backup or durability.

## Watch what a job is doing

Jobs request whole compute nodes, eight GPUs each. The scheduler performs an all-at-once allocation and does not overlap nodes between jobs. Application phases are separate from the high-level job state:

1. **PENDING:** wait for suitable ready nodes and the modeled controller.
2. **STAGING:** use the NS/storage path to prepare input.
3. **COMPUTE:** advance synthetic work while using EW rails.
4. **CHECKPOINT:** commit progress through the storage dependency.
5. **FINALIZING:** publish final results before marking completion.

An active job can be RUNNING while waiting for required I/O. A rail/GPU/path interruption fails it under the chosen model policy. Repair does not automatically make a failed collective succeed: explicitly requeue it from the last committed checkpoint. Uncommitted progress is lost on that modeled restart. This is an instructional restart contract, not a statement about automatic Slurm/NCCL recovery in every environment.

## Understand the arithmetic

The model advances one logical tick at a time. Work progresses by `1.8 × sqrt(allocated nodes) × seeded jitter`, with a synthetic 0.45 multiplier for the RoCE-profile-mismatch lesson. These coefficients are chosen for interaction, not fitted to a device or application. The seed controls a small deterministic variation.

Rail utilization is derived from the fraction of nodes in the compute phase. Counter increments use the assumed link rate, utilization and modeled node count; their displayed four-byte units are an internal model convention. They are not a claim about Ethernet statistics or a measured InfiniBand port. Counter totals retain integer precision using BigInt arithmetic serialized as decimal strings.

The simulator has no packet-level ECN/PFC, credit arbitration, congestion queues, TCP hashing, GPU kernels, actual filesystem I/O, Slurm priorities/backfill or BCM package operations. It is useful for following dependencies and decisions. It is not a hardware sizing or benchmark prediction tool.

## Use the state-aware console

These read commands expose the same virtual state as the interface:

```text
cmsh -c "device list"
cmsh -c "softwareimage list"
cmsh -c "category list"
cmsh -c "network list"
sinfo
squeue
sacct
nvidia-smi -L
nvidia-smi topo -m
cat /proc/net/bonding/bond0
lfs df
mmgetstate -a
```

The selected node controls GPU queries. Storage commands require the chosen backend. Output formatting is simplified and labeled synthetic; it is not a vendor CLI compatibility contract.

Use explicit `sim` commands for model mutations:

```text
sim start
sim step 30
sim submit 2 120
sim drain gpu001
sim resume gpu001
sim fault rail 3
sim repair
sim requeue 1001
```

Unsupported commands are not executed or evaluated. There is no OS shell, SSH endpoint, production-cloud control, host command bridge or network-discovery function.

## Save, restore and reproduce

Export downloads a JSON snapshot containing configuration, nodes, images, counters, jobs, checkpoints, seed state, events and recent metric history. Open a saved session to restore it with the clock paused. Imports are size-bounded and validate identities, eight rails, numeric ranges, allocations and known state values. Do not put real credentials or customer data into a job name or saved file.

Simulation state is stored in your hosted account and can also be exported. Reloading restores the saved session view; resume explicitly to use lab time. The site’s existing optional enquiry-source handling is described separately in [Privacy](/privacy/).

[Start a virtual cluster](/lab/cluster-simulator/) · [Read the eight-rail investigation](/investigations/gpu-rail-matching/) · [Use the other lab tools](/lab/).

## Hosted access and saved progress

The lab requires a verified Wirewalk account and an internet connection. Each account has one five-minute trial. Time begins when you launch or resume the lab; after the trial, a $10 USD purchase adds one hour. No recurring charge is created. The server keeps account time separately from model ticks and imported JSON. Changing the model clock, reloading, importing a session or opening another tab does not reset the balance.

Pause freezes controls and stops time. The model’s speed changes its logical ticks, not the hourly price. One active session is allowed per account. Closing the tab or losing connectivity stops usage within a four-second lease window; reopening restores the latest saved state in a paused view. Export and viewing saved state are available after time runs out.

Only synthetic lab state should be entered. State and usage are now stored on Wirewalk’s Cloudflare service; this replaces the original browser-only model. Earlier published copies of the browser engine cannot be recalled. Paid access covers the current hosted service, not exclusive access to the educational concepts or previously public code. See [access details](/lab/access/) and [privacy](/privacy/).
