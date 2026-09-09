---
title: "Recovery after an administrator account is compromised"
category: "Recovery"
tags: ["Backup", "Identity", "Recovery"]
summary: "A recovery copy is only useful if the people and systems needed to restore it survive the same incident."
date: "2024-09-16"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

A backup job can finish successfully while the recovery design remains vulnerable to one stolen administrator account. The question is whether that account can disable protection, remove recovery points, change retention, or obtain the credentials needed to destroy the other copies.

This is an architecture review and a proposed exercise, not a report of a customer incident. Start with one critical service and trace the actual dependencies needed to bring it back.

## Draw the recovery dependency chain

An example service needs directory authentication, DNS, a virtualization platform, a storage share, database keys, and an application configuration repository. If the backup console authenticates only against the compromised directory, restoring the data does not solve the access problem. If the key server runs only on the failed storage, the recovery order is circular.

Make a worksheet with a row for each dependency:

| Dependency | Normal authority | Recovery authority | Independent copy |
|---|---|---|---|
| Backup catalogue | Backup service account | Recovery operator | Export outside production |
| Encryption keys | KMS administrators | Documented recovery custodians | Supported KMS recovery material |
| Storage configuration | Storage administrators | Restricted emergency account | Protected configuration export |
| Application secrets | Application identity | Approved recovery workflow | Recoverable secret store |

The entries above are a design example. Replace them with named owners and tested procedures. Do not put credentials in the worksheet.

## Test the administrator boundary

Use a disposable dataset under a short, approved protection policy. Enumerate what the ordinary storage administrator, backup administrator, and recovery operator can each do. Test permission denial against that dataset rather than attempting destructive operations against production backups.

A useful negative test asks whether an everyday administrator can shorten retention or remove the final recovery point. A useful positive test asks whether the designated recovery operator can restore the protected copy without the normal production login path. Both are needed: a system that denies everyone is resistant to deletion but may also be impossible to recover.

[CISA's ransomware guidance](https://www.cisa.gov/stopransomware/ransomware-guide) recommends protected backups and recovery testing. The dependency worksheet and role tests here are an engineering method for turning that objective into observable evidence.

## Measure service recovery

Record the start time, chosen recovery point, data restoration completion, application checks, and business acceptance. A mounted filesystem is an intermediate milestone. The application owner should read representative records, perform a controlled write, and confirm access boundaries.

Keep the recovered service isolated until the incident team accepts the source data and credentials. Restoring an old image can restore persistence or a vulnerable configuration along with the application.

## What to retain

Keep the dependency map, permission-test results, recovery-point identifier, elapsed time, and remaining manual steps. Repeat the exercise when identity, encryption, backup tooling, or storage topology changes. Those changes can invalidate recovery without causing a single backup job to fail.

Continue with [replication and failback](/writing/replication-failback-clean-recovery/) and [a restore benchmark](/writing/restore-benchmark-business-recovery/).
