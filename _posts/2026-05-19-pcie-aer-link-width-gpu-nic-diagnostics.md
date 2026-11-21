---
title: 'PCIe diagnosis for GPUs and NICs: follow the link all the way to the root port'
date: 2026-05-19 10:00:00 -0400
category: Systems Management
tags:
- Linux
- NVIDIA GPUs
- RDMA
- Hardware diagnostics
summary: Investigate PCIe link width, speed and AER events across the endpoint, switches and root port, then validate
  the result with GPU, NIC and storage workloads.
seo_title: PCIe Link and AER Troubleshooting for GPUs and NICs
description: Diagnose PCIe link width, speed, AER errors and NUMA locality for NVIDIA GPUs, RDMA NICs and NVMe devices
  in HPC and AI infrastructure.
---

A GPU transfer is slower than expected, yet the GPU's advertised specifications look right. The adapter may be healthy while its slot, upstream switch or root-port connection limits the path. A network adapter or NVMe device can encounter the same problem.

Inspect the complete PCIe path before changing communication libraries or storage tuning. Establish the expected physical layout, read the negotiated state under the workload, and put any error reports on the same timeline as the slowdown.

The Linux references here are frozen at **upstream kernel 6.12**. Distribution kernels can backport features and change reporting. Record the running kernel and installed tools, and treat a missing attribute as unavailable evidence rather than a zero value.

## Start with the platform's intended topology

Build an inventory of the endpoint, slot, riser, PCIe switch and CPU root port. Record which devices share an upstream connection. Include GPU-to-NIC locality and where node-local NVMe sits relative to the processors that drive it.

Compare the discovered tree with the server's supported population rules. A mechanical slot size does not prove the available electrical lane count. Bifurcation, riser selection, occupied neighboring slots and platform configuration can change the usable arrangement.

Keep both expected and observed states. A link narrower than the device's maximum capability may be correct for that server layout. An unexpected change from a previously qualified state is a different finding and deserves an explanation.

A first host inventory can include:

{% include terminal-figure.html key="pcie-aer-link-width-gpu-nic-diagnostics" %}

<details class="terminal-source" markdown="1">
<summary>Read and copy the example as text</summary>

```bash
lspci -D -t
lspci -D -nn
nvidia-smi topo -m
```

</details>

These commands describe different layers. Join the physical devices by PCI address and platform inventory; do not infer that similarly named Linux interfaces share a particular switch or CPU path.

## Compare capability, negotiated state and loaded behavior

For an illustrative endpoint address:

```bash
pci_bdf=0000:81:00.0
lspci -D -s "$pci_bdf" -vv
for field in current_link_speed current_link_width max_link_speed max_link_width; do
  path="/sys/bus/pci/devices/$pci_bdf/$field"
  if [ -r "$path" ]; then
    printf '%s: ' "$field"
    cat "$path"
  fi
done
```

Replace the address with the verified device. Inspect the relevant upstream ports as well. The [kernel 6.12 PCI sysfs implementation](https://raw.githubusercontent.com/torvalds/linux/v6.12/drivers/pci/pci-sysfs.c) defines these link attributes; exposure depends on the device and kernel.

Capture an idle sample and samples during a bounded transfer. Some devices change reported link state with power management, so an idle observation alone can be misleading. Conversely, a stable loaded width below the qualified baseline should not be dismissed because the device is still visible.

Keep units explicit. PCIe transfer rate, lane count, application bytes per second and a bidirectional benchmark total are different quantities. The endpoint's capability is an upper boundary, while actual transfers also pay protocol, memory and software costs.

## Follow every shared upstream connection

Inspect the path from the endpoint through switches and bridges to the root port. A group of endpoints can collectively exceed a shared uplink even when each device has a full-width local link.

Measure one transfer, then the intended concurrent mix. For example, a GPU ingest workload may read local NVMe while a network adapter exchanges data with another node. Each component can pass a solo test and still compete for a common path during training.

Keep CPU and memory placement fixed during these comparisons. Otherwise remote memory traffic or a different process binding can change throughput without any PCIe link-state change. The [CPU, cache and NUMA analysis guide](/writing/amd-uprof-ibs-core-cache-numa-analysis/) provides a complementary host-side investigation.

Do not turn a topology drawing into a bandwidth guarantee. Validate the actual transfer direction, buffer placement and concurrency the research workload requires.

## Interpret AER as a path event with context

The [Linux 6.12 AER guide](https://www.kernel.org/doc/html/v6.12/PCI/pcieaer-howto.html) distinguishes correctable errors from uncorrectable non-fatal and fatal errors. Preserve severity, reporting port, requester information and the full surrounding messages.

A reporting root port is not necessarily the failed component. The event can concern a downstream device or a transaction traversing the hierarchy. Likewise, a GPU disappearing from the bus does not establish whether the GPU, slot, power delivery or another platform component caused the disappearance.

The [AER counter ABI](https://raw.githubusercontent.com/torvalds/linux/v6.12/Documentation/ABI/testing/sysfs-bus-pci-devices-aer_stats) describes errors as seen or reported by the device. Read those counters where exposed and compare interval deltas. Avoid adding endpoint and root-port totals as though they necessarily represent independent incidents. Logs and counters can also have different reset and reporting boundaries.

Linux's visibility depends on firmware granting the operating system control of AER. A quiet kernel log therefore does not prove that the platform has experienced no PCIe problems. Check the system event log and vendor management interface as part of the same incident record.

## Separate link problems from software-path problems

| Observation | Useful next check |
|---|---|
| Unexpected loaded link width or speed | Slot/riser configuration, upstream links and platform history |
| Normal link state, low host-memory transfer | Buffer allocation, NUMA locality, CPU overhead and benchmark setup |
| Host-memory transfer passes, GPU-memory path fails | GPU driver, peer-memory support and application transport |
| Only simultaneous transfers slow down | Shared uplinks, memory bandwidth and CPU placement |
| AER or device loss coincides with the failure | Full PCIe event sequence and platform power/thermal evidence |
| Slow application with healthy transport tests | Data preparation, synchronization, storage and per-rank progress |

NVIDIA's [nvidia-smi reference](https://docs.nvidia.com/deploy/nvidia-smi/index.html) provides GPU-side PCIe information within the full query output. Use it alongside the Linux view rather than substituting one report for the other. Retain driver version and device identity with each capture.

For device-loss incidents, continue with [GPU Xid and ECC triage](/writing/nvidia-gpu-xid-ecc-fault-recovery-triage/). For a working link with poor distributed throughput, the [MPI layered test method](/writing/mpi-layered-test-methodology/) helps isolate the next boundary.

## Make platform changes in a controlled sequence

Preserve the current BIOS, firmware, slot and cabling inventory. Use the server vendor's supported procedure for reseating, riser changes, firmware updates or link configuration. Changes that alter device enumeration need a fresh mapping to scheduler and monitoring identities.

Drain affected work and establish out-of-band recovery before maintenance. Keep a rollback path for configuration changes and test one representative node before applying the same change across a pool.

Avoid masking AER messages as a performance fix. Removing an observation does not establish that the underlying path became reliable. Similarly, forcing a link setting without a matched platform procedure can hide a symptom or reduce available capacity while leaving the cause unresolved.

After maintenance, repeat the same single-path and concurrent tests. An improved isolated result can still conceal a problem that appears only when the node is fully occupied.

## Monitor the qualified path over time

Store expected loaded link state per platform and slot class, rather than one universal fleet value. Alert on changes relative to that baseline and on error activity that coincides with application failures or lost useful throughput.

Join PCI address, physical inventory, GPU UUID, network interface and storage-device identity. Preserve replacement and reboot events so the monitoring history remains interpretable when Linux enumeration changes.

Record the application result with the final topology and counter interval. A repaired path should support the agreed workload at representative concurrency, not merely survive another inventory query. That record also gives the next firmware upgrade a concrete acceptance test.
