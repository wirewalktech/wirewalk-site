---
layout: resource
title: Sample HPC and AI acceptance report
seo_title: Sample HPC and AI acceptance report
description: A fictional example of an HPC and AI acceptance report, including scope, run records, evidence states, findings and handover.
parent_url: /samples/
parent_title: Sample deliverables
nav_section: lab
eyebrow: Illustrative sample
example: true
example_note: This document demonstrates a deliverable format. It is not a commissioned report, customer finding or completed test.
---

## Decision summary

**Illustrative example — no acceptance run has been performed.** This sample shows an evidence-aware report structure. The commissioning decision remains open until the agreed tests and unresolved findings are reviewed by the named owner.

| Item | Example scope |
|---|---|
| System | Two fictional GPU nodes with two physical rails and shared storage |
| Research goal | Repeatable distributed training and usable checkpoint recovery |
| Exclusions | Full model training, facility certification and unapproved failure injection |
| Acceptance owner | Named in the actual statement of work |
| Evidence status | Not run; examples only |

## Reproducibility record

Attach the completed [benchmark manifest](/assets/lab-tools/benchmark-manifest.json), hardware/software baseline, physical rail map, input identity and exact launch command. Record warmup, duration, repeats, placement, precision, batch shape and cache conditions. Do not compare two runs whose scientific work changed.

## Test register

| Test | Purpose | Current sample status | Completion evidence |
|---|---|---|---|
| Device and topology inventory | Confirm delivered configuration | Not run | Baseline and signed-off map |
| GPU peer and network path | Identify supported communication | Not run | Pair tests, runtime path and counters |
| Representative training segment | Measure useful progress | Not run | Step distribution and correctness/quality checks |
| Shared-storage concurrency | Observe input and checkpoint interaction | Not run | Cache-aware workload and per-path evidence |
| Restart | Recover committed useful work | Not run | Restore log and agreed recovery objective |
| Persistence and handover | Make supported state maintainable | Not run | Lifecycle checks, ownership and runbook |

## Findings and decision

Link each deviation to a [finding record](/samples/findings-report/). Distinguish measured nonconformance, inconclusive tests and observations outside the agreed scope. A missing test is not a pass. A benchmark exceeding its target does not waive a failed correctness or recovery requirement.

The final decision states which criteria passed, failed or remain open; who accepts any exception; and whether remediation/retest is included or separately scoped. A vendor-facing summary should retain enough configuration and evidence identity to make the disagreement actionable.

## Handover contents

Provide the report, run manifests, evidence index, topology, prioritized findings, agreed next actions and rollback information. Sensitive raw evidence is delivered through the agreed channel; a public sample must never be substituted for an operational record.


[Download this sample as Markdown](/assets/examples/acceptance-report.md).
