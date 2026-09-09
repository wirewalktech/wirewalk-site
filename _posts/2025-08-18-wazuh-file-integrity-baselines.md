---
title: "Wazuh file integrity monitoring: start with files someone will investigate"
category: "Detection"
tags: ["Wazuh", "FIM", "Linux"]
summary: "A selective baseline and a tested response path make file-change alerts useful."
date: "2025-08-18"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

Monitoring every changing file on a busy server produces activity, but not necessarily useful evidence. A file integrity monitoring deployment should begin with a small set of paths whose unexpected modification has a clear owner and consequence.

## Choose a meaningful baseline

Start with authentication configuration, service definitions, privileged automation, and selected application configuration. Exclude noisy runtime data only after understanding what would be lost. A blanket exclusion for an entire application tree can remove the very files an attacker would alter.

Wazuh documents scheduled and real-time integrity monitoring and platform-dependent capabilities in its [FIM guide](https://documentation.wazuh.com/current/user-manual/capabilities/file-integrity/index.html). Confirm which mode the target operating system and configured paths support.

## Use a harmless configuration fixture

Before applying a broad production policy, create a dedicated directory containing a synthetic text file. Add only that directory to the lab agent's configured monitoring scope using the documented configuration method.

Record the baseline, then make three changes separately: edit the contents, change permissions, and remove the test file. Wait for the configured detection mode and interval after each operation.

| Test | Evidence expected |
|---|---|
| Content edit | Correct path and changed integrity information |
| Permission change | Relevant attribute change, if enabled and supported |
| Removal | Deletion event with the same file identity/path context |
| Agent offline | Missing-agent or freshness signal |

Do not claim attribution unless the configured platform feature actually supplies it. A file change event can establish that a change happened without establishing the process or person responsible.

## Follow the alert to an owner

Inspect the event on the manager and in the analyst view. Confirm hostname, path, timestamp, and the distinction between the original event and ingestion time. A correctly collected event assigned to no one is not an operational detection.

Write a response note for each monitored path family. An unexpected SSH configuration change may require reviewing a deployment record and testing effective settings. An application template change may belong to the application team. Different changes should not all trigger the same emergency response.

## Handle legitimate deployments

Associate maintenance windows with an approved change, but preserve the events. Suppressing all file integrity activity during deployment can conceal an unrelated change. Prefer scoped interpretation and review over discarding the evidence.

After rebuilding an agent or reinstalling a host, confirm that the new baseline is intentional. A newly initialized baseline is not proof that the host matches a trusted image.

## Control volume before expanding

Measure events per host, storage growth, and analyst effort on a representative subset. Expand only when expected events arrive and ordinary maintenance remains understandable.

Finish by repeating the harmless fixture after a policy change or manager upgrade. Pair FIM with [missing telemetry monitoring](/writing/missing-security-telemetry-prometheus/) so a quiet dashboard cannot conceal a disconnected source.
