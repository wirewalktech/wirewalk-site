---
layout: resource
title: Collect a small local infrastructure baseline
seo_title: Collect a small local infrastructure baseline
description: A read-only Python baseline collector for Linux, network interfaces, RDMA link state and NVIDIA GPU model and driver information.
parent_url: /lab/
parent_title: Lab
nav_section: lab
eyebrow: Read-only tool
---

## Establish what is actually running

A baseline should be small enough to read before a test. This collector records OS/kernel and architecture, CPU count, interface names/state/MTU, RDMA device port state/rate/link layer and selected NVIDIA GPU model, driver and memory fields.

It deliberately omits hostnames, IP/MAC addresses, GPU UUIDs, serial numbers, process lists, environment variables and package inventories. It does not provide a complete incident bundle or establish GPU-to-NIC affinity. Collect those separately under the site's access and disclosure rules when the investigation needs them.

[Download inventory.py](/assets/lab-tools/inventory.py) · [View the MIT license](/assets/lab-tools/LICENSE.txt)

```bash
python3 inventory.py --out baseline.json
```

The collector writes a new JSON file with mode 0600 and refuses to overwrite an existing path. Without `--out`, it prints JSON to standard output. Run it as your normal user; do not add elevated privileges to make a missing tool look successful.

## Understand missing data

The script queries NVIDIA devices only when `nvidia-smi` is available. A timeout, missing executable or unsuccessful query is recorded as such. It never turns an unsuccessful GPU query into a statement that the host has no GPUs. Non-Linux execution can still report basic platform details, but the Linux device views may be empty.

The `nvidia-smi` fields and output are version-sensitive. The collector records what its query returns and marks an unexpected field count. A successful query is an inventory observation, not a health check or performance result. See [NVIDIA's CLI reference](https://docs.nvidia.com/deploy/nvidia-smi/).

## Use it around a controlled change

1. Save a baseline before the agreed change.
2. Record the exact change in the run manifest.
3. Collect a new baseline after the lifecycle test.
4. Compare the relevant fields and run the representative workload.

An unchanged inventory does not prove an unchanged application path. Continue with the [GPU guide](/guides/gpu-waiting/) or [distributed-jobs guide](/guides/distributed-jobs/) when communication or placement is the question.
