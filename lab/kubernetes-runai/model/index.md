---
layout: resource
title: Kubernetes and Runai lab operating guide
seo_title: Kubernetes and Runai GPU Lab Guide — Setup, Scheduling and Troubleshooting
description: Follow physical GPU inventory into Kubernetes Nodes and Pods, then investigate Runai quotas, gang placement, GPU Operator faults, storage I/O and safe drain workflows.
parent_url: /lab/kubernetes-runai/
parent_title: Kubernetes and Runai lab
nav_section: lab
eyebrow: Model and exercise guide
no_contact: true
---

[Open the lab](/lab/kubernetes-runai/). It uses the same physical reference stack as the cluster simulator: 2–128 servers, eight GPUs and eight EW rails per server, Spectrum-X/RoCE or InfiniBand, a two-member NS bond, and Lustre or GPFS storage. Kubernetes and a Run:ai-inspired scheduler sit above that inventory.

This is a hosted behavior model. It does not start a Kubernetes control plane, load NVIDIA software, provide a Run:ai license or execute training on GPUs. Timing, counters and work units are chosen for investigation, not throughput prediction. The reference is deliberately smaller than a complete Kubernetes or Run:ai implementation.

## One server, two operational views

`gpu001` names a physical server and its corresponding Kubernetes Node. It does not represent two sets of GPUs. The server owns eight device identities, numbered GPU0–GPU7. Pod placements reference those same identities.

| Figure | Meaning in this lab |
|---|---|
| Physical GPUs | Eight devices per server in the hardware inventory |
| Kubernetes capacity | Devices represented on registered Nodes |
| Allocatable | Healthy devices advertised through the modeled NVIDIA stack |
| Allocated | Device identities currently assigned to workers |
| Free resources | Eligible, healthy devices not assigned to another worker |

A registered Node can retain capacity 8 while an unhealthy device reduces allocatable to 7. Allocatable is not the same as free: running workers consume it. If the advertisement component is unavailable, this model reports zero advertised GPUs while preserving existing worker assignments. That immediate reporting rule is a teaching assumption; real kubelet/device-plugin failure timing varies.

A stopped GPU Operator management component does not automatically remove functioning device-plugin advertisements or stop existing operands. A runtime/toolkit fault can leave GPUs advertised while a newly assigned container waits to start. These are different repair paths from a stopped device plugin.

A healthy physical host is not sufficient proof of Kubernetes readiness. Registration, kubelet availability and GPU advertisement are separate. Conversely, a lost kubelet heartbeat does not necessarily stop containers that are already executing. The model lets existing application work continue when its physical resources and data paths remain usable.

## Build a reference stack

Choose a guided start to enable each layer deliberately, or an already enabled reference stack for a quick investigation. Both begin with modeled physical provisioning.

1. Advance the model until the physical image is installed. Its GPU driver is supplied by the prepared reference image.
2. Bootstrap the Kubernetes API and CNI stage. Registered Node objects now refer to those servers.
3. Enable the GPU Operator / toolkit / advertisement stage. This represents component readiness; no Helm chart or DaemonSet is actually installed.
4. Enable the CSI adapter and the `research` PVC. It binds to an assumed pre-provisioned shared volume once backing storage is available.
5. Enable Run:ai management when using the Run:ai profile. Inspect the two project policies before submitting training.

The control-plane service is a single availability gate. Etcd quorum, multiple API servers, certificates, CNI implementation details and real operator reconciliation are not emulated. The generic CSI adapter is a lab abstraction, not a claim that Lustre and IBM Storage Scale use interchangeable drivers or manifests. Production installation needs the supported driver, version, access mode and deployment method for the chosen storage product.

## Compare scheduling behavior

Each workload requests a number of worker Pods and 1, 2, 4 or 8 whole GPUs per worker. The reference plan spreads one workload's workers across distinct physical servers. This constraint represents an explicit placement policy, not Kubernetes' universal default. Multiple different workloads may share a server through different device identities.

**Run:ai profile:** the scheduler plans all missing worker allocations before assigning any of them. If a complete group cannot fit, the workload waits without taking a partial initial allocation. The model uses two projects, one GPU pool and integer-GPU quotas. It does not implement departments, weighted hierarchical fairness, topology scoring, fractional GPU allocation, time slicing, MIG or the full Run:ai CRD/API surface.

Only preemptible work can exceed its project's deserved quota, and borrowing must be allowed. An in-quota request can reclaim borrowed resources from preemptible work in another project. Workload priority is compared within its own project; it is not a global right to evict protected work elsewhere. Reclamation is attempted only when the resulting placement can actually fit. The model can reclaim a whole workload, so its granularity is coarser than a full production scheduler.

**Native Kubernetes comparison:** worker Pods are placed individually. A group can hold one worker's GPUs while another worker waits. The application makes progress only when all its required workers are ready. This profile illustrates partial placement; it is not the complete Kubernetes scheduling plugin pipeline or a PriorityClass preemption simulator.

The model rejects deserved quotas whose sum exceeds physical capacity. Existing non-preemptible work is not silently killed by changing a policy. Real quota, fairness and priority settings must be reviewed against the deployed Run:ai version and organizational hierarchy.

## Follow a workload through the layers

A submitted workload begins Pending. After placement, workers can remain Pending with an image or container-startup reason. The model retains their assigned GPU IDs while they wait; those devices cannot also be allocated to another worker.

- `ImagePullBackOff`: the modeled image reference is unavailable. Repair it rather than changing a GPU quota.
- `ContainerCreating: CNI unavailable`: new containers cannot obtain the required network setup. Already running containers keep their established network in this model.
- `UnboundPersistentVolumeClaim`: the research claim has not bound, so placement waits.
- `ContainerCreating: CSI/backing storage unavailable`: the claim exists, but a new worker cannot mount it.
- `ProjectQuotaExceeded`: the requested work would borrow despite being non-preemptible, or borrowing is disabled.
- `GangWaiting`: the complete Run:ai group cannot be placed under the current resource and spread constraints.

Running work passes through staging, compute, application checkpoints and final publication. A shared-storage or NS failure may leave it Running while it waits at an I/O boundary. A Bound PVC remains Bound during that data-path outage. A CSI-controller outage alone does not invalidate a previously established mount in this model.

Multi-node training requires its modeled RDMA attachment and EW rails. Their loss aborts the collective under a conservative failure assumption. A single-node workload does not require that EW path. An unhealthy GPU affects a workload only when that particular device was assigned to it. A failed workload stays failed until explicitly restarted; repairing hardware does not rewrite its result.

The application writes a checkpoint every ten modeled work units. Preempted work can be queued again from its last committed checkpoint. This does not mean Run:ai saves a process's GPU memory or automatically makes an arbitrary program checkpoint-aware. The training application in this model is explicitly assumed to implement restart from shared-storage checkpoints.

## Exercise: healthy server, zero advertised GPUs

Start a ready reference stack and confirm the physical servers are UP. Start the GPU-advertisement exercise. Compare the physical inventory with Kubernetes capacity and allocatable values:

```console
sim layers
kubectl get nodes -o wide
kubectl describe node gpu001
```

Existing worker assignments remain visible, but new GPU placements wait. Restore GPU advertisement in Dependencies, then submit a **new** validation workload. Exercise completion requires diagnosis while the problem exists, a repair, and a fresh workload that publishes its final output.

## Exercise: borrowed capacity and deserved demand

Finish or cancel existing work first. The quota exercise submits an alpha workload large enough to occupy the cluster, marks it preemptible and sets an eight-GPU deserved quota for each project. Let it reach Running and inspect project accounting.

```console
sim projects
runai list jobs
```

`sim projects` is a Wirewalk helper. The `runai list jobs` alias is a limited, legacy-inspired teaching command, not a compatibility guarantee for current Run:ai CLI releases.

Submit a beta workload with one worker and eight GPUs. Its in-quota demand can reclaim the alpha borrower's resources. Inspect the borrower's preemption count and committed checkpoint. It must not be charged a second allocation while waiting to resume. Then submit a fresh validation workload to complete the exercise. A higher priority number in a different project is not what grants the reclamation right.

## Exercise: cordon, drain, disruption budget and reimage

Finish or cancel other work, then start the PDB exercise. It creates a protected single-worker training workload. Find the physical node hosting that worker in the Pod table; do not assume its name.

```console
kubectl get pods -A -o wide
kubectl cordon gpu001
kubectl drain gpu001 --ignore-daemonsets
kubectl get pdb -A
kubectl get events -A
```

Replace the example node with the actual worker location. Cordon stops fresh placements; the existing worker continues. With `minAvailable: 1`, this single worker cannot be voluntarily evicted through the modeled budget gate. Inspect the blocked drain, then deliberately finish/cancel the workload or lower its budget before retrying maintenance.

A successful drain releases only the affected worker's allocation. Other live worker replicas remain assigned while the group waits for a replacement. Physical reimage is refused unless the node is cordoned and has no worker allocations. Reimage does not automatically uncordon it.

PDBs are not protection against hardware failure. This lab applies the budget to its voluntary drain path; it does not treat the budget as a guarantee against Run:ai resource reclamation or every form of Kubernetes preemption. Real Kubernetes scheduler preemption treats PDB support as best effort. DaemonSet eviction rules, termination grace periods, force flags and all controller behaviors are outside the finite drain model.

## Use the console without guessing its scope

The GUI covers operations outside the finite command subset:

```console
kubectl get nodes -o wide
kubectl describe node gpu001
kubectl get pods -A -o wide
kubectl get pvc
kubectl get events -A
kubectl get pdb -A
runai list jobs
sim projects
sim layers
sim submit alpha 2 8
sim step 30
sim repair
cmsh -c "device list"
```

The output reads the same model as the controls and is labeled synthetic. Unsupported input is not evaluated, sent to SSH or executed as a host command. A failed API gate prevents API queries and submissions, even though the lab's separate physical monitor can still show its simulated state.

## Saved state, recipes and access

The server automatically saves the complete current model, including workloads, checkpoints and allocations. Reloading shows that state paused. The downloadable **setup recipe** is intentionally narrower: it preserves the selected physical topology, component settings, node controls and project policy. Import provisions a fresh model and clears workload, exercise and evidence progress. It is not a backup of live training state and cannot import account credit.

This lab shares the same account balance as the cluster and four switching labs. Each verified account gets one five-minute trial; a new prepaid hour costs **$20 USD**. There is no recurring subscription or overage charge. Existing purchased minutes and earlier started checkouts retain their terms. [Access and privacy details](/lab/access/).

## Primary sources and review boundary

Reviewed November 21, 2026. These sources establish the underlying concepts, not conformance of this independent model to an installed product release.

- [Kubernetes device plugins and unhealthy-device accounting](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/).
- [Kubernetes safe drain](https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/), [disruption budgets](https://kubernetes.io/docs/tasks/run-application/configure-pdb/) and [priority/preemption limitations](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/).
- [NVIDIA GPU Operator 25.10 troubleshooting](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/25.10/troubleshooting.html).
- [NVIDIA Run:ai scheduling concepts](https://docs.nvidia.com/run-ai/self-hosted/v3.0/documentation/platform-management/runai-scheduler/scheduling/concepts-and-principles), [priority and preemption policy](https://docs.nvidia.com/run-ai/self-hosted/documentation/platform-management/runai-scheduler/scheduling/workload-priority-control) and [project organization](https://docs.nvidia.com/run-ai/self-hosted/v3.0/documentation/platform-management/manage-ai-initiatives/organization/projects).
- [NVIDIA BCM 11 containerization manual](https://docs.nvidia.com/base-command-manager/manuals/11/containerization-manual.pdf) describes a real product path; no copy of that software or its installation is supplied here.

Run:ai project identifiers and the lab's alpha/beta groups are simplified. Real Run:ai can use project-backed Kubernetes namespaces such as `runai-<project>`; this lab does not claim its short group names reproduce the default namespace naming scheme. CPU/memory accounting, real manifests, RBAC, TLS, admission webhooks, etcd, GPU sharing and packet-level performance require separate implementation and validation.
