---
title: "Suricata IPS: turn detection into blocking without guessing about failure"
category: "Detection"
tags: ["Suricata", "IPS", "AF_PACKET"]
summary: "An inline sensor is part of the availability path. Validate forwarding, selective blocking, and failure behavior separately."
date: "2025-06-07"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

Changing a signature from alerting to dropping is only one part of an IPS rollout. Traffic must traverse the enforcement path, legitimate work must continue, and the organization must understand what happens when the sensor or capture process fails.

## State the enforcement design

Suricata documents inline operation at Layer 2 and Layer 3. Its IPS concept uses drop or reject actions for unwanted traffic. AF_PACKET inline deployments require an explicitly paired interface design. See [IPS concepts](https://docs.suricata.io/en/suricata-8.0.1/ips/ips-concept.html) and [Linux inline setup](https://docs.suricata.io/en/suricata-8.0.1/ips/setting-up-ipsinline-for-linux.html).

These links describe Suricata 8.0.1; use the equivalent pages for the installed supported release before configuring production. The design tests below do not depend on a particular interface name or release default.

## Establish the failure policy before installation

Decide whether the protected service should lose connectivity or pass traffic without inspection when the enforcement path fails. Hardware bypass, queue behavior, routing, and process failure can produce different outcomes. “Fail open” in a slide deck is not an observed result.

Document a bypass procedure and the person authorized to invoke it. It should be reachable through a management path independent of the traffic being inspected.

## Use three traffic classes

| Class | Expected outcome |
|---|---|
| Ordinary business transaction | Allowed, within agreed latency |
| Benign fixture matching the test drop rule | Blocked and logged |
| Similar fixture that should not match | Allowed |

Run these in an isolated lab first. Use a harmless synthetic signature rather than malware. Confirm the blocked transaction fails at the client and is recorded by the sensor. An alert alone does not prove enforcement.

Record the exact rule set and configuration. Start production rollout with a small, justified set of blocking rules after observing them in alerting mode. Retain an explicit rollback version rather than editing rules under pressure.

## Exercise operational failures

In the lab, stop the process, remove one test link, and simulate loss of management access one at a time. Inspect client behavior for each condition. Repeat with a long-lived connection as well as new connections; the outcomes may differ.

Under representative traffic, measure packet drops, application error rates, and latency percentiles. An inline system with acceptable average latency can still cause intermittent application timeouts.

## Keep exceptions narrow and expiring

A false positive should produce a scoped exception with the affected service, rule identifier, owner, and review date. Disabling an entire ruleset because one application fails makes the enforcement policy hard to understand.

Before declaring the deployment accepted, rerun the three traffic classes through the final path and demonstrate rollback. Preserve the results with the change record. Pair this with [detection regression tests](/writing/detection-rules-regression-tests/) so future rule updates do not silently alter the policy.
