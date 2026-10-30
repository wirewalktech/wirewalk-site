---
title: "Batch or streaming: event time, watermarks, and replayable results"
date: "2026-01-21 10:00:00-05:00"
category: "Data Engineering"
tags: ["Streaming", "Batch Processing", "Event Time", "Data Correctness"]
summary: "How to choose a freshness model and design streaming correctness around event time, late data, idempotent effects, checkpoint state, deduplication, backfills, and reconciliation with batch results."
description: "How to choose a freshness model and design streaming correctness around event time, late data, idempotent effects, checkpoint state, deduplication, backfills, and reconciliation with batch results."
---

“Real time” is often specified before anyone states how fresh the result needs to be. A dashboard may tolerate fifteen minutes. A control system may need milliseconds. A daily accounting result may value completeness and reconciliation more than immediate visibility. Those requirements lead to different architectures.

Choose batch, microbatch, or continuous processing using the decision deadline, the arrival pattern, and the consequences of revising an answer. The processing engine is one component of that contract.

## Define freshness and completeness separately

Freshness measures how quickly available data becomes visible. Completeness asks whether all relevant events have arrived and been incorporated. A result can be fresh and incomplete, or complete and delayed.

For an illustrative hourly production dashboard, distinguish “events received in the last hour” from “events that occurred during that hour.” A device that uploads its morning measurements at noon changes the second result but not the first.

State the allowed lateness, when results are provisional, when they become final, and how corrections are communicated. If the business requires historical revisions, the storage and consumer interfaces must support them.

## Preserve multiple clocks

Event time is when the source says something happened. Ingestion time is when the platform received it. Processing time is when a particular stage handled it. Keep these values distinct where the use case needs them.

Validate source clock quality. A malfunctioning device with a future timestamp can distort event-time progress if the design trusts it blindly. A source that changes time zones or sends ambiguous local timestamps needs normalization rules and error handling.

Retain enough raw information to diagnose those decisions. Dropping the original timestamp and timezone after parsing makes later corrections much harder.

## Use watermarks as state-management policies

A watermark helps an engine decide when event-time state can be retired or results advanced. It is not proof that no older event will ever arrive.

The [Spark 3.5.1 Structured Streaming guide](https://raw.githubusercontent.com/apache/spark/v3.5.1/docs/structured-streaming-programming-guide.md) explains event-time windows, watermarks, and guarantees around late data. Behavior depends on the operator, output mode, and query structure. Avoid reducing those conditions to “all data later than the delay is always dropped” or “nothing is ever lost.”

Choose the delay using observed lateness and business consequences. Longer retention can improve completeness but increases state and recovery cost. Measure state size, update rate, checkpoint duration, and the effect of idle or slow sources.

## Give every side effect a replay policy

A streaming engine may recover and replay input after failure. The destination must handle that replay correctly. A database upsert keyed by a stable event identifier differs from an unkeyed append or an external notification.

Define event identity independently from delivery attempt identity. Deduplicating only on a transport offset may not remove an event that was published twice under different offsets. Deduplicating only on a payload hash may incorrectly collapse two legitimate identical measurements.

For external effects, use an idempotency key or a durable outbox and a receiver that honors the intended contract. A successful checkpoint cannot make an arbitrary third-party action exactly once. Validate the behavior across the boundary between input progress, computation state, and destination commit.

## Bound deduplication and aggregation state

An unbounded stream can imply unbounded state if every identifier must be remembered forever. Choose retention based on the maximum relevant duplicate interval and correction policy, then document what happens outside it.

Windowed aggregates need explicit keys and boundaries. Test events exactly on a boundary, negative or missing timestamps, duplicate arrivals, and records corrected after initial acceptance. Define how a retraction or replacement updates earlier aggregates.

Watch state growth as a service metric. A query that processes every batch successfully while its state store grows without limit is accumulating an outage.

## Treat checkpoint compatibility as an interface

A checkpoint records progress and state for a particular query and implementation. Changing sources, stateful operators, schemas, or runtime versions can affect whether it is safe to resume.

Test upgrades with a representative checkpoint in an isolated environment. Confirm both recovery and output equivalence for the intended change. Do not delete a production checkpoint as a routine fix without understanding whether the restart will replay input, lose state, or duplicate effects.

Keep source retention long enough to support the recovery objective. A perfect checkpoint policy cannot replay events that the source has already expired when recovery requires them.

## Design backfills as first-class operations

Historical reprocessing competes with live traffic and may encounter different schemas or business rules. Give it an input snapshot, transformation version, output namespace, and resource budget.

Write a backfill to a separate version or controlled staging destination, reconcile it, and publish it through a deliberate switch. Mixing a historical replay into the live destination without version or idempotency rules can double counts or overwrite newer corrections.

Keep the logic shared where practical, but test equivalence rather than assuming shared code guarantees it. Streaming state, batch ordering, and late-event policies can create different results from the same transformations.

## Reconcile with a bounded batch reference

For selected closed intervals, recompute results from retained raw data and compare them with the streaming output. Account for the declared lateness policy, accepted corrections, deduplication horizon, and source completeness.

Investigate discrepancies by event identity. Aggregate totals can match while the wrong records cancel each other. Use row-level comparisons for critical outputs and summarize differences by reason.

A reconciliation job also needs an owner and alerting. A silent comparison that stopped running is not a continuing correctness control.

## Choose the simplest architecture that meets the deadline

A scheduled incremental batch may meet a fifteen-minute requirement with less state and fewer recovery paths. A low-latency stream may be justified when a delayed decision loses value. Some systems need both a provisional stream and a reconciled batch view.

Record the tradeoff: freshness target, completeness policy, replay horizon, state budget, and recovery procedure. The architecture is ready when it can explain what a number means, when that number may change, and how the same result can be reconstructed after failure.
