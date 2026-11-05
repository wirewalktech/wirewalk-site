---
title: "Slurm and Kubernetes integration: decide who owns each resource"
date: "2026-10-30 10:00:00 -0400"
category: "HPC Architecture"
tags: ["Slurm", "Kubernetes", "NVIDIA", "GPU Scheduling"]
summary: "Compare separate worker pools, Slurm on Kubernetes and coordinated scheduling, then test GPU ownership, identity, storage and failure recovery before sharing capacity."
description: "Design Slurm and Kubernetes integration around resource ownership, GPU allocation, identity, storage and failure recovery."
---

A simulation team wants multi-node batch allocations; a platform team needs notebooks, inference endpoints and services. Sharing their GPU fleet is an appealing way to use expensive capacity, provided both teams can still rely on their workloads' placement and recovery.

Decide who owns each allocation before connecting the schedulers. Slurm and Kubernetes must not independently promise the same GPU, including during cancellation, worker loss and upgrades.

This article compares architectural patterns and proposes an acceptance process. It does not prescribe a particular operator release or promise that every Slurm feature works in every Kubernetes environment. Examples describe hypothetical infrastructure, without production topology or identities.

## Begin with the workloads rather than the tools

List the workloads that genuinely need to share capacity. Include task count, GPU type, CPU and memory shape, network requirements, data locality, runtime and tolerance for interruption. A notebook that remains idle overnight has different needs from a tightly coupled simulation that must launch every rank together.

Identify what the users need to preserve. Slurm users may depend on accounts, fair share, reservations, job arrays and familiar launch behavior. Kubernetes users may depend on service discovery, declarative reconciliation, deployment controllers and workload identity.

Do not assume one interface must absorb the other. A shared storage platform, common image pipeline and separate worker pools can solve much of the operational duplication while keeping scheduling authority simple.

## Compare three distinct patterns

| Pattern | Scheduling authority | Main operational question |
|---|---|---|
| Separate worker pools | Each scheduler owns a disjoint pool | How is capacity transferred safely? |
| Slurm hosted on Kubernetes | Kubernetes places Slurm components; Slurm places batch jobs within the supported design | How do nested resource limits and node lifecycles interact? |
| Coordinated scheduling | An integration coordinates selected work across systems | Who is authoritative for each allocation and release? |

These are not equivalent deployment options. They have different failure modes and support requirements. Start with the least complex pattern that satisfies an actual workload requirement, then measure whether its limitation justifies more coordination.

For separate pools, define a formal handoff if machines change roles: drain, finish work, clean state, change ownership, validate and admit. A node label alone is not evidence that old processes and device allocations have disappeared.

## Understand the scope of Slinky components

SchedMD's [Slinky overview](https://slurm.schedmd.com/slinky.html) distinguishes `slurm-operator`, which runs Slurm on Kubernetes, from `slurm-bridge`, which connects selected Kubernetes scheduling to Slurm. Review those projects separately rather than treating the Slinky name as a single behavior guarantee.

Pin the supported combination of Slurm, Kubernetes, operator or bridge, container runtime and host OS. Read its release-specific limitations and upgrade instructions before a pilot. The architecture should not depend on a feature seen only in a newer demonstration or an unreleased branch.

Write down which workloads are in scope for coordination and which remain outside it. A bridge handling selected pods does not automatically make every Kubernetes controller, resource type or scheduling policy compatible with Slurm accounting.

## Draw the resource-ownership boundary

For each GPU, CPU set and memory budget, identify the authority that can grant it and the mechanism that prevents another grant. Include the host's own services and any management pods. Capacity consumed below the Slurm boundary must not also be advertised as available to jobs.

Nested limits matter. If a Slurm worker runs inside a pod with a memory limit, all of its child workloads must fit the effective parent constraint. A job request can appear valid to Slurm and still exceed the outer boundary. Inspect the supported cgroup delegation design rather than assuming privileged execution fixes it.

Kubernetes [Topology Manager](https://kubernetes.io/docs/tasks/administer-cluster/topology-manager/) provides policies for aligning topology hints from participating resource managers. It is another placement consideration, not a substitute for a single ownership model. Validate CPU, GPU and NIC locality on the actual supported stack.

## Assign driver and device management once

NVIDIA's [GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/overview.html) manages GPU software components in Kubernetes deployments. A cluster image may already manage some of those components. Decide which mechanism owns each layer before installing both.

The ownership record should cover the kernel driver, container integration, device advertisement, monitoring and any partitioning configuration. If the driver is supplied by the host image, configure the operator according to that supported model. Avoid two reconcilers repeatedly replacing one another's state.

Test device identity by UUID across both interfaces. An allocated GPU must remain attributable to its job or pod, and a cancellation must release the resource only after the supported cleanup completes. A device being listed in both systems is not proof that ownership is coordinated.

## Map people, projects and data access

A Kubernetes service account and a Unix UID describe different identities. A pod creating a Slurm job needs a controlled mapping to the user, project and account that will own the work. A shared privileged submission identity can destroy the accountability the organization expected Slurm to provide.

Define how cancellation, quotas and audit events follow that mapping. Preserve a stable link between the originating request, pod identity, Slurm job ID and resulting data. Restrict impersonation and administrative actions to the required integration components.

Storage access needs the same care. Test numeric ownership, supplementary groups, ACL behavior, credentials and read-only mounts. A workload writing files successfully is not sufficient if those files later belong to an identity the research team cannot use.

## Design recovery before increasing scale

Use a pilot with a small set of noncritical resources. Exercise worker loss, controller restart, an unavailable API, pod eviction and cancellation during startup. Ask which system retains ownership while the other is unreachable.

An uncertain allocation should not be made available twice. Conversely, an abandoned allocation should eventually be reconciled and released under a documented procedure. Record how the integration distinguishes those cases and what an operator must inspect before intervening.

For long-running inference or notebook workloads, test how termination is communicated. For multi-node jobs, test partial placement and a worker disappearing after peers have started. Workload-level readiness and meaningful recovery are more demanding than a controller reporting that all desired pods exist.

## Measure useful capacity rather than shared visibility

Define success using completed research work and service objectives. Compare queue wait, job completion time, startup overhead, failed allocations, service latency and operator effort. A dashboard showing more busy GPUs can conceal slower jobs and harder incident recovery.

Include a rollback path that restores exclusive ownership to separate pools. Retain the original image and scheduling definitions, and verify cleanup before moving machines back. The ability to reverse a pilot is part of its design.

Before sharing the fleet, demonstrate allocation and release while one control system is unavailable. If ownership cannot be reconciled safely, keep the worker pools separate until a supported coordination path is ready.

Read next: [Docker or Apptainer for research computing: compare the operating models](/writing/docker-apptainer-research-container-operating-models/), [Advanced Slurm setup: prove CPU, memory and GPU isolation before admitting jobs](/writing/slurm-cgroup-v2-gpu-isolation-validation/).
