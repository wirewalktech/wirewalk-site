---
layout: resource
title: Calculate counter rates without losing the evidence
seo_title: Calculate counter rates without losing the evidence
description: An offline counter-delta calculator with exact integer input, explicit byte units, timestamp validation and reset or wrap rejection.
parent_url: /lab/
parent_title: Lab
nav_section: lab
eyebrow: Offline analysis tool
---

## Take differences over a known interval

A cumulative counter becomes a rate only when its units, sampling interval and continuity are known. This tool reads local CSV samples and emits adjacent-interval deltas. It does not read hardware or reset counters.

[Download counter-delta.py](/assets/lab-tools/counter-delta.py) · [Download synthetic samples](/assets/lab-tools/counter-samples.csv)

```bash
python3 counter-delta.py counter-samples.csv --unit-bytes 4
```

The supplied data is synthetic. For these fixtures, the computed rail-a rate is 1.000000 GiB/s and rail-b is 0.500000 GiB/s. That demonstrates the arithmetic, not any adapter's capability. The input starts above 2^53 so an implementation that first converts counter values to floating point can lose integer precision.

## Know what one unit means

Pass the number of bytes represented by one raw counter unit. The InfiniBand `port_xmit_data` and `port_rcv_data` definitions use four-octet units; do not transfer that assumption to unrelated Ethernet statistics, vendor telemetry or other counters. Confirm the exact interface against the [kernel ABI reference](https://www.kernel.org/doc/Documentation/ABI/stable/sysfs-class-infiniband).

The output reports raw delta, selected unit size, bytes per second and GiB per second. GiB means 2^30 bytes. A counter name does not make a rate into measured application throughput.

## Fail rather than conceal a broken interval

The parser rejects missing headers, duplicate timestamps for the same device/counter, non-finite timestamps, negative values, incomplete series and decreasing counters. A decrease might be a reset or wrap; the tool emits no rates instead of choosing a wrap width on your behalf. Save a new continuous interval after identifying the cause.

Capture counter timestamps as close to the actual read as practical. Sequential samples across a fleet are not automatically simultaneous. For tightly synchronized comparisons, use a collector whose per-sample timestamps and acquisition overhead are understood.

[Read the InfiniBand counter guide](/writing/infiniband-error-counters-deltas-not-totals/) or [follow the distributed-jobs guide](/guides/distributed-jobs/).
