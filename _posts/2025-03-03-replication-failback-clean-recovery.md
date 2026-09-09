---
title: "Replication and failback: choose a clean recovery point before reversing direction"
category: "Recovery"
tags: ["SyncIQ", "Replication", "Disaster recovery"]
summary: "Remote availability, historical recovery, and returning service to the primary site require separate decisions."
date: "2025-03-03"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

Replication can faithfully transfer an unwanted change. That is useful for availability and dangerous when an operator mistakes the remote copy for an independently protected history. The recovery plan must say which failure it covers.

## Classify the event before promotion

A failed primary site, a deleted directory, and a compromised administrator require different decisions. Site failure may justify promoting the latest consistent replica. Corruption may require an older recovery point. Compromise also requires deciding whether identities, configuration, and the destination remain trustworthy.

Write the intended decision path before the incident:

| Event | First recovery question |
|---|---|
| Hardware or site outage | Is the latest replica complete and usable? |
| Accidental change | Which earlier point contains the required data? |
| Suspected compromise | Which point and administrative boundary can be trusted? |
| Return to primary | Which site now owns authoritative writes? |

These are operating decisions. The replication engine cannot infer them from a successful transfer.

## Make authority explicit

A promotion procedure should identify who can stop writes, declare the source fenced, select the recovery point, and open the destination to applications. Include the behavior of clients with stale connections and old DNS answers.

For PowerScale SyncIQ with SmartLock, use Dell's documented source/target and failback constraints. The [OneFS replication limitations](https://www.dell.com/support/manuals/en-us/isilon-onefs/ifs_pub_backup_and_recovery_guide_9.9.0.0/smartlock-replication-limitations?guid=guid-250c03c8-56b7-41c9-b418-7ec149ed2cbc) demonstrate why a generic “reverse replication” step is inadequate. Other platforms require their own supported workflow.

## Rehearse the full round trip

In an isolated environment, create a baseline dataset, replicate it, and record checksums. Simulate source unavailability without deleting the source. Promote through the supported procedure, make a controlled change at the recovery site, and confirm that only the intended site accepts writes.

Now rehearse the return. Preserve the destination's new data, re-establish the intended relationship, and confirm which copy wins. A test ending immediately after promotion misses the part that can overwrite valid recovery-site work.

## Measure application consequences

Time the last accepted source write, recovery-point availability, promotion, application readiness, and return to steady operation. Record any accepted data loss against the service's agreed recovery-point objective. Measure user-visible downtime against the recovery-time objective.

Use the same credentials and network routes expected during an actual outage, except where the lab intentionally substitutes test identities. If a privileged engineer manually repaired five undocumented dependencies, those are findings, not a passing automated recovery.

## Keep history outside the propagation path

Maintain a recovery strategy that can survive harmful changes being replicated. That may include protected historical copies and separate administrative authority, selected for the product and threat model. Document the retention window and the maximum time the business expects to take to detect corruption.

See [administrator-compromise recovery](/writing/recovery-after-admin-compromise/) for the authority review that complements the data path.
