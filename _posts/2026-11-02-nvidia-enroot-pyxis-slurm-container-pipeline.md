---
title: "NVIDIA containers under Slurm: operating Enroot and Pyxis as a supported service"
date: "2026-11-02 10:00:00 -0500"
category: "GPU Infrastructure"
tags: ["NVIDIA", "Enroot", "Pyxis", "Slurm", "Containers"]
summary: "Build a supported NVIDIA container path around Pyxis and Enroot, immutable images, cache placement, GPU constraints and multi-node acceptance tests."
description: "Operate NVIDIA Enroot and Pyxis on Slurm with pinned images, validated GPU access, cache planning, MPI checks and upgrade controls."
---

A good GPU container service should let a researcher submit the application they need without spending the allocation installing packages or debugging the cluster's runtime. That requires more than adding a container option to `srun`. Image delivery, host-driver compatibility, device ownership and cleanup must work together.

NVIDIA's Enroot and Pyxis provide a useful execution path for Slurm environments. Enroot supplies the container environment, while Pyxis integrates containerized task execution with Slurm through SPANK. Treat that integration as maintained infrastructure with a release process, rather than a plugin copied into place once and forgotten.

The patterns below assume an administrator-supported installation. They use generic paths and an illustrative image; they do not install software or modify a live cluster.

## Assign each component a job

[NVIDIA's Pyxis project](https://github.com/NVIDIA/pyxis) documents its Slurm integration, requirements and runtime options. [Enroot](https://github.com/NVIDIA/enroot) supplies the underlying unprivileged sandbox workflow. Neither replaces Slurm's allocation policy or the host's running kernel driver.

The NVIDIA Container Toolkit is a related part of the broader GPU container ecosystem, with runtime-specific integration described in its [architecture overview](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/arch-overview.html). Do not assume every runtime uses the same configuration path just because it runs the same NVIDIA framework image.

Write down who owns the host driver, GPU device constraints, Enroot configuration, Pyxis plugin and image catalog. That ownership record is essential when an upgrade changes behavior at a boundary between teams.

## Pin the plugin to the Slurm build

Pyxis documents a build compatibility requirement with the deployed Slurm release. Preserve the package build inputs and rebuild or validate the plugin as part of a Slurm upgrade, before returning compute nodes to service.

Do not test only `srun --help` on a login node. Plugin availability at the client and successful initialization on compute nodes are separate observations. Use a canary allocation to verify parsing, launch and cleanup.

Read Slurm's [container integration guide](https://slurm.schedmd.com/containers.html) before combining SPANK-based execution with built-in OCI configuration. The guide warns about conflicts between those paths. A site should have an intentional supported execution model rather than two partially configured mechanisms competing at launch time.

## Promote an image before a researcher requests it

Select a framework release based on its application requirements and host compatibility, not merely the newest tag. NVIDIA's [PyTorch 24.10 release notes](https://docs.nvidia.com/deeplearning/frameworks/pytorch-release-notes/rel-24-10.html) illustrate the kind of versioned record to retain: framework components, CUDA stack, driver requirements and known issues.

Record the registry digest, scan or review result, license requirements, expected invocation and validation workload. If the site converts an OCI image into another artifact, record the converted artifact's checksum too.

Use an immutable approved artifact for execution. A mutable tag can point to different software between two jobs. If users need to develop interactively, separate that working environment from the artifact promoted for repeatable production runs.

## Keep import traffic out of the critical path

A cold image import can read large layers, unpack files and consume temporary capacity. Hundreds of jobs doing that independently can overload a registry or shared filesystem before useful computation begins.

Plan cache, runtime and temporary directories as separate storage concerns. Determine their ownership, quota, cleanup policy and behavior after a reboot. A node-local cache improves locality only if a missing artifact can be restored reliably and its contents remain attributable to a known image.

Measure cold and warm startup independently. Test concurrent launches at the intended scale, not just one interactive session. Record registry failures and cache misses separately from application runtime. A fast warm launch does not establish that a full fleet can start after maintenance empties local caches.

## Launch a bounded GPU acceptance job

For a site that has staged an approved SquashFS artifact, the basic shape is:

```bash
# Within an allocation that explicitly includes a GPU.
srun --ntasks=1 \
  --container-image=/project/example/images/validated-pytorch.sqsh \
  --container-mounts=/project/example/input:/input:ro,/project/example/output:/output \
  python -c 'import torch; print(torch.cuda.is_available()); print(torch.ones(8, device="cuda").sum().item())'
```

The paths and image name are illustrative. The installed Pyxis version must support the selected options and artifact format. The allocation must already request the intended GPU; a container option is not a resource request.

Check the program's output and return code. Then validate a representative application kernel, data access and output ownership. A trivial tensor operation is an initial functional test, not a performance or scientific-correctness result.

## Reconcile driver, libraries and device identity

The container does not supply the host's loaded NVIDIA kernel module. Use NVIDIA's [CUDA compatibility guidance](https://docs.nvidia.com/deploy/cuda-compatibility/minor-version-compatibility.html) and the selected framework release notes to review that boundary.

Record GPU UUIDs, host driver version, container artifact and application library versions. Confirm that the requested device is usable and unallocated devices are inaccessible under the site's supported policy. Environment variables alone are not enforcement.

Test ordinary GPU jobs and CPU-only jobs through the runtime. Also test a failed launch. A partially initialized container must not leave mounts, processes or runtime directories that affect the next allocation.

## Validate multi-node execution separately

A one-GPU success establishes little about MPI, PMIx, RDMA or distributed framework rendezvous. Use the site's approved launcher and test progressively: one node, two nodes and the intended scale.

Check selected communication transports and per-rank GPU assignment. Keep a native or previously validated baseline using the same node placement and message sizes. If a transport fallback is used for diagnosis, remove it before promoting the image unless the fallback is an explicit supported choice.

Save cancellation and timeout results too. A distributed application can start correctly and still expose cleanup problems when one rank fails. The operational contract includes how the allocation becomes reusable after that failure.

## Handle writable state and credentials deliberately

Do not assume changes made during an interactive container session become part of the image used by future jobs. Define where package caches, temporary files, model downloads and user configuration live. Mutable writable state can undermine an otherwise pinned image.

Registry credentials belong in the site's supported credential mechanism, with permissions appropriate to the account and workload. Do not place tokens in job scripts, command-line examples or broadly readable logs. Diagnostic bundles should preserve image identity without exposing authorization material.

Separate cache cleanup from job-output cleanup. Deleting a runtime cache should be recoverable; deleting research results is a different operation with a different owner and retention policy.

## Release the runtime as a tested combination

Maintain a small acceptance matrix covering host image, Slurm, Pyxis, Enroot, driver, framework artifact and representative workloads. Run it on a drained canary after a relevant change, including a controlled reboot when host state is involved.

Keep a rollback package and the previous validated image references. The point is not to freeze the platform indefinitely. It is to make upgrades predictable enough that researchers can spend their time on experiments rather than reconstructing which layer of the GPU container stack changed last night.

Read next: [Docker or Apptainer for research computing: compare the operating models](/writing/docker-apptainer-research-container-operating-models/), [Advanced Slurm setup: prove CPU, memory and GPU isolation before admitting jobs](/writing/slurm-cgroup-v2-gpu-isolation-validation/).
