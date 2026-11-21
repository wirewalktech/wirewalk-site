---
layout: resource
title: Keep a benchmark record another engineer can reproduce
seo_title: Keep a benchmark record another engineer can reproduce
description: Download a benchmark manifest validator and HPC or AI acceptance worksheet that retain workload, placement, cache conditions and evidence.
parent_url: /lab/
parent_title: Lab
nav_section: lab
eyebrow: Run records and handover
---

## Write down the question before the command

A run record connects a result to its workload, environment and acceptance criterion. The template separates input identity, software versions, topology, placement, cache policy, warmup, duration, repetitions, metric and evidence references.

[Download benchmark-manifest.json](/assets/lab-tools/benchmark-manifest.json) · [Download validate-manifest.py](/assets/lab-tools/validate-manifest.py) · [Download acceptance-checklist.csv](/assets/lab-tools/acceptance-checklist.csv)

```bash
python3 validate-manifest.py benchmark-manifest.json
```

The supplied template has status `not_run` and value `not_measured`. It is intentionally illustrative. Replace all placeholders before collecting evidence; its example durations and repetitions are not a recommendation for your benchmark.

## What validation does and does not establish

The validator checks required sections, selected nested fields, numeric ranges and consistent result states. A `pass` or `fail` entry requires a finite numeric value and evidence references. A `not_run` entry requires `not_measured`. The validator does not run the workload, inspect referenced files, prove the identity of an input, approve a criterion or attest that a claimed pass is true.

A structurally valid template is a starting record. Review it with the engineers and researchers who own the workload. Retain actual logs, immutable container identities where used, topology and selected counters alongside the record.

## Agree on completion

Use the checklist to record each criterion's owner, evidence and status. Include correct output, concurrent demand, storage behavior, checkpoint recovery, configuration persistence and administrator handover. Keep unresolved items visible in the final report.

[See a sample acceptance report](/samples/acceptance-report/) · [Follow the cluster-acceptance guide](/guides/cluster-acceptance/) · [Read about acceptance testing services](/services/hpc-ai-benchmarking/).
