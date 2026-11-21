---
layout: resource
title: Sample infrastructure findings report
seo_title: Sample infrastructure findings report
description: A fictional GPU and fabric finding showing evidence, uncertainty, impact, proposed remediation, ownership and the verification needed to close it.
parent_url: /samples/
parent_title: Sample deliverables
nav_section: lab
eyebrow: Illustrative sample
example: true
example_note: This document demonstrates a deliverable format. It is not a commissioned report, customer finding or completed test.
---

## Finding F-001: effective rail mapping needs validation

**Illustrative finding, not a customer incident.** The constructed [rail-matching scenario](/investigations/gpu-rail-matching/) has different device enumeration on its two nodes. That creates a mapping question; it is not by itself proof of a performance defect.

| Field | Example entry |
|---|---|
| Classification | Configuration/qualification gap |
| Priority | Proposed P2; actual priority agreed against workload impact |
| Affected scope | The two-node canary and its selected GPU/HCA pairs |
| Owner | Platform engineer, named in the real report |
| Status | Open — scenario evidence is illustrative |

## Observation and limits

The fictional physical map associates rail-a with mlx5_0 on node-a and mlx5_1 on node-b. A policy that assumes identical indices would need review. The sample contains no production packet trace, measured application degradation or proof that the communication library selected the wrong path.

The real evidence package would identify exact software builds, GPU and NIC physical identity, rank placement, effective configuration and per-port activity over the same workload interval. Each attachment should have a stable filename or content hash and a collection time.

## Why the team would care

An unmaintained mapping can complicate performance diagnosis, hardware replacement and upgrades. The impact statement in a commissioned report should describe the observed workload behavior and its operational consequence, with scope. Do not translate a theoretical extra hop into an invented research delay or revenue figure.

## Proposed action

Build and review the physical identity map. Run a small, approved comparison between the baseline placement and a supported candidate configuration. Retain the original settings and a rollback procedure. Promote a change only when it improves or restores the agreed behavior without breaking correctness, isolation or other supported work.

## Closure evidence

- Effective configuration and map match the approved design.
- Intended paths are supported by runtime evidence and counter deltas.
- Representative application comparison meets its agreed criterion.
- Persistence, replacement and handover procedures name an owner.
- Remaining uncertainties and accepted exceptions are explicit.

A reviewer records the closure decision and evidence. A changed configuration file or a successful command exit is not sufficient on its own.


[Download this sample as Markdown](/assets/examples/findings-report.md).
