---
layout: "service"
permalink: "/services/parallel-storage/"
title: "Parallel storage setup and performance review"
seo_title: "GPFS, Lustre & Parallel Storage Consulting"
description: "Parallel storage setup and diagnostics for GPFS, IBM Storage Scale, Lustre, WEKA and VAST, with workload tests, client checks and administrator handover."
service_id: "parallel-storage"
---

## Connect storage design to research use

A filesystem serving instrument ingest, large shared files and millions of small samples must support several access patterns. I help identify the important ones, understand their overlap and choose a setup or diagnostic scope around them.

The fixed-scope ordering option covers setup and configuration of one agreed GPFS, Lustre, WEKA or VAST filesystem and its client connections. My broader storage experience also includes PowerScale / Isilon and DDN; work on those systems or other requirements can be discussed and scoped separately.

## Check the client and network paths

A storage problem may originate before a request reaches the disks. I examine mounts, client configuration, identity, RDMA or network paths and concurrent load alongside server-side observations. On multihomed systems, that includes checking whether the intended client paths are actually usable.

Capacity checks cover the relevant allocation domain, including pools, filesets, quotas and file counts where applicable. The investigation follows the failing operation and its time window, so aggregate free space or bandwidth does not hide the constraint affecting a particular job.

## Test the operations that matter

The work includes workload-based throughput and latency tests, bottleneck investigation and agreed tuning. IOR, mdtest and representative application operations can separate data transfer from metadata activity, while cache state and client placement are recorded with the result.

For training and analysis pipelines, the test may include dataset access, concurrent readers and checkpoint activity. We agree the workload, sizes and concurrency before interpreting the measurements. No fixed throughput improvement is promised independently of the hardware and application.

## Plan data movement and recovery

Migrations, snapshots, replication, backup and archive need their own ownership and recovery checks. If they are relevant to the engagement, we agree which paths and procedures are included and what the team needs to validate afterward.

The filesystem service includes written findings, agreed tuning, a readout and administrator handover. Hardware, software licenses, travel, ongoing support and additional work outside the accepted scope are separate. A brief qualification call establishes the scope; a paid architecture assessment is not required before booking.
