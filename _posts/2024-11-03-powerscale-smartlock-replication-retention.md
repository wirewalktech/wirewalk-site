---
title: "PowerScale SmartLock: a successful replica can have the wrong protection"
category: "Storage security"
tags: ["PowerScale", "Isilon", "SmartLock", "SyncIQ"]
summary: "Check destination WORM state and retention explicitly instead of treating a successful replication job as proof."
date: "2024-11-03"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

On a Dell PowerScale or older Isilon estate, SnapshotIQ, SyncIQ, and SmartLock answer different questions. A point-in-time view, a remote copy, and a write-once retention policy should not be represented by one green status in an operations dashboard.

The particularly useful failure case is a replica whose data arrived but whose intended retention protection did not.

## Read the source-to-target rules

Dell's OneFS 9.9 backup guide documents that replicating a SmartLock enterprise directory before creating the target SmartLock directory can produce a normal target directory and a successful job. It also states that directory configuration is not carried across merely because WORM file state is replicated. See [SmartLock replication limitations](https://www.dell.com/support/manuals/en-us/isilon-onefs/ifs_pub_backup_and_recovery_guide_9.9.0.0/smartlock-replication-limitations?guid=guid-250c03c8-56b7-41c9-b418-7ec149ed2cbc).

Those are release-specific rules, not permission to improvise on an existing compliance cluster. Consult the installed release's guide before designing or changing the topology.

## Separate four acceptance questions

| Question | Evidence |
|---|---|
| Did data arrive? | Destination file contents and replication completion |
| Is the destination a SmartLock domain? | Destination domain configuration |
| Is this file committed with the expected retention? | File state and expiration |
| Can the service recover there? | Controlled recovery and client access test |

A checksum answers only the first row. A successful SyncIQ run does not replace the remaining rows.

## Build a representative test

Use an isolated source directory and a separate target path. Include a committed test file, an uncommitted file, and the directory settings the application depends on. Keep the retention window short enough for the approved lab exercise; retention changes can be irreversible within that window.

Record the source and target domain types before replication. Run the supported policy, inspect the destination independently, and confirm that a client with ordinary write access cannot alter the committed test file. Verify the expected expiration rather than assuming every file inherited the same policy.

Then evaluate failback using Dell's matrix for the exact domain pair. A recovery plan that describes only copying forward leaves the harder operational decision unresolved.

## Treat time and workflow as dependencies

Dell documents additional planning for compliance-mode failover, including cluster configuration and compliance clocks. [Its failover guide](https://www.dell.com/support/manuals/en-us/isilon-onefs/ifs_pub_backup_and_recovery_guide_dell_emc/smartlock-compliance-mode-failover-and-failback?guid=guid-5f55892f-92b6-4219-bf55-4d79cfae4499&lang=en-us) should be part of the change record.

Keep retention requirements separate from product feature names. Choosing a mode does not establish the organization's regulatory compliance. The engineering deliverable is a verified source-to-target protection contract, a recovery procedure, and documented ownership of exceptions.

For the wider recovery sequence, read [replication and clean failback](/writing/replication-failback-clean-recovery/).
