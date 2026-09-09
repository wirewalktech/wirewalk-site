---
title: "Restore benchmarks: measure the time until the business can work"
category: "Recovery"
tags: ["Backup", "Performance", "RTO", "Storage"]
summary: "Throughput is one component of recovery. Metadata, identity, keys, and application validation can dominate elapsed time."
date: "2026-07-20"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

A restore speed of several gigabytes per second can sound reassuring while saying little about the time needed to recover a real service. The benchmark must include the dataset shape and the work that happens before and after copying bytes.

## Define the finish line

Choose a service and define the recovery-time objective with its owner. Separate data availability from application readiness and business acceptance. Record the recovery point and acceptable data-loss window independently.

Use a representative dataset: large files, small files, directory depth, permissions, and application metadata. A single large sequential file is an inadequate model for a namespace containing millions of small objects.

## Establish a lower bound

A simple transfer-time calculation is useful as a sanity check:

```text
100 TiB / 2 GiB per second = 51,200 seconds = about 14.2 hours
```

This is arithmetic, not a measured product result. It excludes initialization, metadata work, protocol overhead, retries, and application checks. Use consistent units and actual sustained throughput from the intended recovery route.

If the business requires recovery in four hours, a fourteen-hour byte-transfer lower bound already demonstrates a design mismatch. No dashboard wording can close that gap.

## Time the complete sequence

| Milestone | Record |
|---|---|
| Recovery authorized | Start timestamp |
| Credentials and keys available | Access preparation delay |
| Destination ready | Provisioning delay |
| Namespace available | Initial mount or restore completion |
| Working set read | Cold-access completion |
| Application accepted | Business validation timestamp |

WEKA's [Snap-To-Object documentation](https://docs.weka.io/weka-filesystems-and-object-stores/snap-to-obj) notes on-demand recovery considerations. Similar distinctions should be investigated for any product that exposes data before all of it is local. Do not equate a quick mount with a fully recovered working set.

## Avoid cache-driven optimism

Run the first representative read separately from repeat reads. Record whether source or destination caches were warm and whether object-store retrieval was involved. A second run can measure a different system path.

Measure file-count and metadata progress as well as bytes. Preserve failure and retry counts. A benchmark that silently skipped unreadable files can report excellent throughput while failing its purpose.

## Validate data and authority

Compare a pre-recorded manifest, checksums for the test corpus, ownership, and expected access. Then execute an application transaction. Include a denied-access test for an unrelated user so the restored service does not trade availability for excessive exposure.

## Report the actual result

Publish the dataset, tool versions, topology, elapsed milestones, throughput, errors, and manual interventions. Label estimates as estimates and lab results as lab results. Do not extrapolate a small trial linearly without explaining the limits.

The useful deliverable is a recovery time the business can assess, together with the bottleneck that must change if it is too slow.
