---
title: "Missing security telemetry: monitor the silence as well as the alerts"
category: "Detection"
tags: ["Prometheus", "Monitoring", "SIEM"]
summary: "A quiet dashboard can mean no incidents, a broken producer, or a source that vanished from inventory."
date: "2025-10-29"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

A collector answering health checks can still receive no useful events. A source removed from service discovery may disappear from every dashboard. Security monitoring needs a separate definition of which sources should exist and how recently each should have produced evidence.

## Distinguish three failure states

A known target can be down. A known target can be reachable but stale. A target can be missing from discovery entirely. One uptime graph does not cover all three.

Use an inventory of required sensors and log producers. Include ownership, expected event cadence, and maintenance rules. Compare observed sources against that inventory rather than deriving the entire expectation from whatever happened to report today.

## Express freshness explicitly

Prometheus documents `absent_over_time` and time functions in its [query reference](https://prometheus.io/docs/prometheus/latest/querying/functions/). For an exporter that you implement to publish the most recent event time, illustrative expressions are:

```promql
(time() - security_last_event_timestamp_seconds{source="storage-audit"}) > 900
```

```promql
absent_over_time(security_last_event_timestamp_seconds{source="storage-audit"}[15m])
```

`security_last_event_timestamp_seconds` is an example metric, not a built-in metric supplied by a storage vendor or Prometheus. The first expression detects old values; the second detects no samples for the explicitly named source. Neither automatically enumerates every missing source in a changing fleet.

The 15-minute window is illustrative. Select the threshold from the system's real event behavior and response requirement. A genuinely idle source needs a heartbeat or controlled validation event rather than an assumption that user activity is continuous.

## Test the alert chain

In a lab, stop the event producer while leaving the exporter running. Confirm the stale-event alert. Then stop the exporter and confirm missing-sample or target-down behavior. Finally remove the source from discovery and verify that inventory reconciliation still identifies it.

These tests isolate different failure modes. If the third condition becomes invisible, the monitor still has an absence problem.

## Carry enough context to act

An alert should name the producer, last event time, last successful collection, owning team, and a short diagnostic procedure. A generic “no data” notification encourages responders to guess whether the event source, network, parser, or query failed.

Preserve maintenance windows with expiry. A permanent silence created for a temporary outage can make the monitoring system look healthy for months.

## Check timestamps and delivery

Clock skew can make a producer appear fresh or stale incorrectly. Compare event time with ingest time and monitor clock synchronization independently. Confirm that alert routing reaches a staffed destination using an approved test notification workflow.

The completed control is not a query that evaluates successfully. It is an expected source inventory, a freshness signal, and a demonstrated response when each part stops working. Apply the same approach to [storage audit pipelines](/writing/storage-audit-evidence-pipeline/).
