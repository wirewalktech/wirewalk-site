---
title: 'Linux NVMe multipath and ANA: test the failure boundary the application depends on'
date: 2026-10-21 10:00:00 -0400
category: Storage
tags:
- Storage
- NVMe
- NVMe over Fabrics
- Linux
summary: Map namespace identity and path independence, inspect ANA state, and validate failure and restoration with
  application-level data checks instead of relying on path counts.
seo_title: 'Linux NVMe Multipath and ANA: Failover Validation'
description: Validate Linux NVMe multipath and ANA using namespace identity, path independence, controlled failover
  timing and application integrity checks.
---

Two NVMe paths in an inventory can still share the component whose failure stops the application. They may traverse one adapter, switch, controller or power domain. The path count alone says little about the failure the storage service can tolerate.

Build the dependency map first, then test the intended failure boundary in an agreed maintenance experiment. Linux native NVMe multipath, controller state, ANA information and the application's completion behavior all contribute evidence. None is a substitute for the others.

The examples use Linux and `nvme-cli` 2.11-style read-only commands. Transport support, policies and recovery behavior depend on the deployed kernel, distribution and storage product.

## Establish one namespace identity across the paths

Start with subsystem and namespace identity, then map the controllers that provide access. Confirm that the paths refer to the same intended logical resource. Do not infer this from matching capacity or similar Linux device names.

Useful observations include:

```bash
nvme version
nvme list -o json
nvme list-subsys -o json
lsblk -o NAME,TYPE,SIZE,FSTYPE,MOUNTPOINTS
findmnt -rn -o TARGET,SOURCE,FSTYPE
```

Retain persistent namespace identifiers and their support context. The [list-subsystems manual](https://github.com/linux-nvme/nvme-cli/blob/v2.11/Documentation/nvme-list-subsys.txt) describes the tool view; the storage service's inventory should establish the identity and ownership behind that view.

Keep the filesystem or volume's actual backing device in the map. Application I/O must use the intended aggregated resource rather than an individual path selected accidentally by a setup script.

## Identify which layer owns multipathing

Determine whether the service uses Linux native NVMe multipath or another supported stack. Inspect the effective configuration, not just the package list. Avoid layering or disabling path managers without understanding which component currently owns the device.

The [kernel NVMe multipath guide](https://docs.kernel.org/admin-guide/nvme-multipath.html) describes merging namespace paths and policy selection. Available policies vary across kernel versions. Read the deployed kernel's documentation and the storage vendor's support requirements before treating a policy from a current guide as available everywhere.

For native multipath, a read-only check of the module parameter can help:

```bash
cat /sys/module/nvme_core/parameters/multipath
```

Interpret this with kernel configuration and the actual device topology. A missing file or an enabled parameter alone does not establish that the namespace is currently operating through the intended multipath arrangement.

## Interpret ANA within the actual topology

Asymmetric Namespace Access describes access state for namespace groups through controllers. An optimized path and a non-optimized path are not simply two equivalent links with different display labels. The host's policy must account for the state the subsystem advertises.

Where supported, inspect the ANA log through the relevant controller:

```bash
nvme ana-log /dev/nvme0 -o json
```

The [ANA-log reference](https://github.com/linux-nvme/nvme-cli/blob/v2.11/Documentation/nvme-ana-log.txt) requires a controller character device. Record state and collection time for the relevant paths. Not every device supports the same capability set, and a static snapshot does not describe how quickly a transition becomes visible during failure.

For NVMe over Fabrics, retain transport endpoints and the network path. For a supported dual-port local configuration, retain PCIe and platform relationships. In both cases, map the shared subsystem that can affect every path at once.

## Define the failure model before interrupting anything

Choose the event the service is supposed to tolerate: losing one link, one adapter path, one controller or an entire host is a different test. Identify the exact components affected and which independent route should remain.

Use a dedicated test namespace or an approved maintenance boundary. Keep a supported recovery method and a stop condition. Do not disconnect a production path merely because a synthetic workload can continue on another node.

Multipathing provides access-path resilience, not independent copies of the underlying data. If all paths reach the same damaged namespace or failed subsystem, additional host routes do not create a recoverable copy. Keep backup and replication requirements in their own design.

## Measure the application's pause and completion semantics

Run a bounded workload with known data and a clear integrity check. Record baseline latency, throughput, error handling and write-completion behavior. Define what counts as successful recovery before injecting the event.

During the agreed failure, retain controller and path transitions, host kernel events and application timing over the same interval. Record the longest observed interruption and whether the application received errors, retried or completed without awareness of the path event.

Do not count a process remaining alive as a successful failover. It can remain blocked while making no useful progress. Conversely, an application that handles a documented transient error correctly can satisfy a service requirement even though its log is not entirely quiet. Judge the result against the agreed contract.

## Test restoration as carefully as failure

Restore the path through the supported procedure and observe rediscovery, identity and access state. Check that no duplicate or stale device view appears in the storage layers used by the application.

Allow the workload to continue long enough to inspect the restored operating state. A path that reconnects but repeatedly fails under load is not a stable recovery. Record any changed traffic distribution and compare it with the selected policy's documented behavior.

Repeat only the failure cases needed to validate the design. Uncontrolled repeated disconnects can obscure the first failure and add avoidable stress to the service. Preserve the original evidence before conducting a second experiment.

## Keep recovery policy consistent with workload needs

Review timeout, reconnect and controller-loss behavior as a combined policy with the storage vendor. A setting that shortens one test's pause may cause an application to receive errors earlier during a legitimate recovery event.

Use the workload's tolerance and data semantics to choose a supported configuration. Avoid copying timeout values from a different transport or changing a machine-wide policy to improve a single benchmark without assessing other consumers.

Keep the qualified configuration and test result with the node image or service release. Recheck relevant behavior after kernel, firmware or storage-controller changes. For the controller software side, use [NVMe firmware lifecycle management](/writing/nvme-firmware-slots-activation-maintenance/); for the identity map every test depends on, see [controller and namespace inventory](/writing/nvme-controller-namespace-identity-management/).
