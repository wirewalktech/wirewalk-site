---
title: "VAST indestructible snapshots: test the authority to undo protection"
category: "Storage security"
tags: ["VAST", "Snapshots", "Ransomware"]
summary: "Retention, administrative separation, support unlock, and recovery are different parts of the same protection design."
date: "2024-10-10"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

A read-only snapshot stops a client from overwriting its historical contents. It does not automatically stop a storage administrator from removing the snapshot. For VAST, the distinction to examine is the protection attached to snapshots and policies, together with the authority that can change that protection.

## Establish the documented boundary

VAST documents an Indestructibility feature that protects flagged snapshots and protection policies against deletion and retention reduction. Its architecture documentation also describes a controlled, time-limited support unlock. That exception belongs in the security model: the customer representatives and verification procedure behind it matter as much as the checkbox. See [VAST's overview](https://kb.vastdata.com/documentation/docs/en/indestructibility-overview) and [the platform white paper](https://www.vastdata.com/whitepaper).

Confirm the documentation for the installed VAST software release. Do not infer that a feature name proves protection against every administrator, every support workflow, or the loss of the entire site.

## Write a protection inventory

For every protected path, record its policy, snapshot frequency, retention, replication destination, and responsible team. Record whether protection was explicitly enabled and whether the most recent recovery point completed. A configured schedule and an existing snapshot are separate facts.

| Review item | Evidence to collect |
|---|---|
| Scope | Protected path and a file known to reside beneath it |
| History | Actual recovery-point timestamps |
| Retention | Expiration shown for a specific protected snapshot |
| Authority | Roles allowed to change policies or request unlock |
| Off-site survival | Recovery point visible at the intended peer |

Export the inventory to an access-controlled evidence location. A screenshot without a snapshot identifier is difficult to reconcile later.

## Exercise a disposable policy

Create a small test dataset through the normal client protocol. Take a protected recovery point with an approved test retention. Modify the live test data and verify that the earlier version remains readable through the supported recovery workflow.

Use an ordinary administrative role to attempt a forbidden policy or retention change on this test scope. Record the denial and the identity used. Then inspect the configuration again: an error message is less persuasive than a confirmed unchanged protection state.

Separately review the support-unlock contacts and approval process with the customer owner. Do not initiate an unlock merely to prove the support channel exists. A tabletop review can establish who is authorized and how a compromised mailbox would be handled.

## Plan for capacity and recovery

Retained history occupies capacity as the live dataset changes. Model a high-change incident window as well as routine daily churn. An unexpectedly long retention period can create an operational problem precisely because ordinary deletion is restricted.

Finally, restore to an isolated destination and validate representative file contents, permissions, and application behavior. Snapshot survival is the first result; usable recovery is the second. Keep both in the acceptance report, alongside [the identity boundary around recovery](/writing/recovery-after-admin-compromise/).
