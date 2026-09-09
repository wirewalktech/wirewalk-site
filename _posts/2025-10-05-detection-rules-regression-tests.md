---
title: "Detection engineering: keep a test that must match and one that must not"
category: "Detection"
tags: ["Suricata", "Snort", "Regression testing"]
summary: "A small fixture library makes rule changes reviewable and keeps false-positive fixes from silently removing coverage."
date: "2025-10-05"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

A detection rule has two obligations: identify the behavior it was written for and leave expected activity alone. Testing only the first produces false positives; testing only the second can remove the detection entirely.

## Write the detection contract

For each rule, record the behavior, required telemetry, expected event fields, and the response owner. Describe the scope narrowly enough to test. “Detect suspicious traffic” is not a specification. “Alert on this synthetic request pattern in this inspected HTTP path” is.

Keep one approved matching fixture, one ordinary nonmatching fixture, and any fixture added after a false positive. Use synthetic captures or appropriately sanitized authorized data. Store hashes and provenance so later reviewers know exactly what was exercised.

## Use the engine's parser

Suricata and Snort have documented configuration tests and offline capture modes. See [Suricata's CLI reference](https://docs.suricata.io/en/suricata-7.0.8/command-line-options.html) and [Snort's traffic inspection guide](https://docs.snort.org/start/inspection). Validate the complete configuration used for the test, not just a detached rule string.

The test record should contain:

```text
rule_id: locally assigned identifier
engine_version: exact installed version
configuration_hash: recorded SHA-256
fixture_hash: recorded SHA-256
expected: alert present or alert absent
observed: matching identifiers and count
```

This is a schema example, not measured output. Record the actual values from the run.

## Assert the right event

Do not accept “one or more alerts” as proof. Assert the intended rule identifier and, when relevant, the source, destination, or application field. A completely unrelated signature can otherwise make a broken test look successful.

For suppression and threshold rules, define the expected count or range explicitly. Replay timing matters: an accelerated fixture may not behave like the original traffic window. Record the timing method and engine options.

## Separate detection from delivery

An offline fixture proves engine behavior. A live benign event proves the collection and routing path. A ticket or notification received by the intended responder proves delivery. Maintain all three where the control depends on all three.

If the product is deployed inline, add an observed client transaction result. A drop action in a file does not prove the forwarding path enforced it.

## Make exceptions testable

When narrowing a rule to fix a false positive, add that legitimate example to the fixture library before changing the rule. Rerun both the old match and the new nonmatch. An exception should identify its owner, scope, and review date rather than becoming an undocumented global bypass.

Keep fixture size modest and access controlled. Packet captures can contain credentials and personal data even when the original investigation seemed routine.

## What to release

Release the rule, its tests, configuration changes, and results together. Keep the previous working version available for rollback. This turns a ruleset update into an engineering change with known behavior rather than a hopeful increase in the number of enabled signatures.
