---
title: "Redfish firmware rollouts for HPC: from inventory to verified readmission"
date: "2026-10-25 10:00:00 -0400"
category: "Systems Management"
tags: ["Redfish", "Firmware", "Slurm", "NVIDIA", "Change Management"]
summary: "Plan firmware maintenance by hardware compatibility and failure domain, track transfer and activation separately, then verify boot, fabric, storage and scheduled workloads before readmission."
description: "Run controlled HPC firmware rollouts with Redfish inventory, canaries, activation tracking, failure-domain limits and Slurm readmission tests."
---

Do not return a node to researchers just because its firmware update task succeeded. First check what booted and run a small scheduled workload. The package can be installed correctly while the host has lost an adapter, changed topology or booted from the wrong target.

Firmware maintenance on HPC and GPU systems needs checks for CPU topology, PCIe devices, adapter enumeration, link speed and boot order. Follow the update from the BMC through the operating system and back into the scheduler.

Use the platform's documentation for package dependencies, application timing and recovery. The procedure below outlines a generic rollout using supported Redfish capabilities; it contains no power or flash commands.

## Build a compatibility inventory

Collect model, hardware revision, installed components, current firmware, boot mode and relevant operating-system stack. Include adapters and accelerators rather than treating the server as one versioned object.

Discover the UpdateService and its linked firmware inventory. Preserve the actual resource identity and component mapping. Two entries with similar names may describe different banks, devices or stages of activation.

DMTF's [UpdateService schema](https://redfish.dmtf.org/schemas/v1/UpdateService.v1_11_1.json) defines standard properties and actions, but implementation support varies. Compare the discovered service with the vendor's supported update method. Do not assume that a package valid for one server family applies to a superficially similar chassis.

## Separate package approval from execution

For each package, retain the vendor source, checksum, signature-verification result where supported, supported hardware, dependencies, prerequisites and downgrade policy. A package filename is not a sufficient identity.

Choose an approved target combination, not merely the latest individual component releases. Firmware, host drivers and fabric software may have compatibility requirements that make a mixed set inappropriate.

Record why the change is needed: a security correction, a supported-stack requirement or a verified fault. That purpose determines the acceptance tests. An update intended to fix link recovery should include a relevant recovery test, not only a general boot check.

## Define the failure-domain budget

Group nodes by their role and shared dependencies. Compute nodes, login nodes, controllers and storage servers cannot share one generic concurrency setting. Several individually healthy resets can still remove a critical service if they occur together.

For compute maintenance, drain nodes through the scheduler and wait for the agreed workload condition. Do not interpret a drained state as proof that no process or service depends on the host. Confirm jobs, interactive sessions and any non-Slurm responsibilities.

Storage maintenance needs the storage platform's supported redundancy and recovery procedure. Never reuse a compute-node batch policy for storage servers merely because both expose Redfish. Stop conditions should include degraded redundancy, ongoing rebuilds and any loss of the management recovery path.

## Validate the out-of-band path before disruption

Confirm management connectivity, target identity and available recovery mechanisms before initiating an update. Check the console or equivalent recovery access that would be needed if the operating system fails to return.

Distinguish a management-controller reset from a host reset. An update may temporarily interrupt the BMC without rebooting the host, or may require a later host power cycle to activate. The automation must know which event it expects and how long its timeout reasonably allows.

The [ComputerSystem schema](https://redfish.dmtf.org/schemas/v1/ComputerSystem.v1_17_0.json) describes standard reset and boot properties. Use the actual service's advertised capabilities; a schema enum lists possible values, not a guarantee that every device supports them all.

## Treat transfer, installation and activation separately

DMTF's [Firmware Update White Paper 1.1.0](https://www.dmtf.org/sites/default/files/standards/documents/DSP2062_1.1.0.pdf), published in September 2025, describes update workflows including image transfer and installation. A transferred image may be staged for later activation rather than immediately running.

Track these phases explicitly in the maintenance record. Preserve the response, task monitor, task messages and required next action. If a reset is needed, identify who owns it and whether it is included in the approved window.

Do not equate `OnReset` with permission to reset whenever convenient. It describes application timing. The scheduler, research workload and service owners still determine when disruption is acceptable.

## Use one canary per meaningful hardware class

Choose a canary that represents the component combination being updated. One successful host does not validate a different motherboard revision, accelerator type or network adapter.

Save pre-change inventory and configuration, then follow the vendor-supported update sequence. Reconcile uncertain task outcomes before retrying. If the network connection drops after submission, the operation may still be running.

After activation, rediscover resources. Device identifiers and inventory paths may change. Rebind the automation to stable asset identity rather than continuing with a stale URI that happened to work before the update.

## Verify what booted and what the OS sees

Compare the running firmware with the approved target. Then check the host's boot mode, boot target, CPU topology, memory inventory, PCIe devices and relevant driver initialization.

For an NVIDIA GPU node, compare GPU UUIDs, driver health and PCIe topology with the pre-change record. For an RDMA node, confirm expected adapters, active links, addresses and supported communication tests. A host reachable by SSH can still be missing the device that makes it useful.

Verify that required filesystems are mounted from their intended sources. A missing shared mount can leave an ordinary local directory underneath it. A simple write test without mount identity can therefore certify the wrong storage path.

## Readmit through the scheduler, not around it

Compare the controller's resource view with the host inventory. A topology change can make an old node definition inaccurate even when the hardware itself is healthy. Resolve registration and GRES mismatches before accepting production work.

Run a small scheduled acceptance job covering the node's role: CPU placement, bounded memory behavior, GPU computation, storage access and communication where relevant. Check output correctness and cleanup, not just process startup.

Only resume the node after the agreed gates pass. A failed acceptance test should leave it unavailable with a concise reason and an evidence path. Automatically resuming every host whose SSH port opens removes the protection the maintenance workflow was meant to provide.

## Make rollback realistic

Firmware rollback is not always supported, immediate or safe. Some updates change persistent formats, security settings or compatibility assumptions. Check the vendor's documented downgrade constraints before claiming that the previous package is a recovery plan.

Prepare supported recovery media or procedures and retain configuration backups where applicable. If the platform cannot be downgraded, define an alternative containment plan, such as leaving the canary drained while the issue is investigated.

Do not begin the next wave while the canary has unresolved anomalies. Increasing concurrency to recover schedule time after a warning multiplies uncertainty across the fleet.

## Preserve a per-node release record

Record asset identity, previous and target versions, package identity, operation and task IDs, activation event, health-test results and scheduler readmission time. Keep credentials and sensitive inventory details out of public reports.

Expand in bounded waves with explicit stop conditions. Compare post-change workload behavior with the baseline, including failures and tail latency rather than only best-case throughput.

Keep failed nodes drained, with the failed test and recovery plan attached. For nodes that pass, retain the version and workload results before readmission so the next maintenance window starts from a known baseline.

Read next: [Advanced Redfish automation: discovery, tasks and uncertain outcomes](/writing/redfish-automation-state-machines-tasks-etags/), [Advanced Slurm setup: prove CPU, memory and GPU isolation before admitting jobs](/writing/slurm-cgroup-v2-gpu-isolation-validation/).
