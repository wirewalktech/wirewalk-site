---
title: "Encrypted traffic: decide what each security sensor can actually establish"
category: "Detection"
tags: ["TLS", "Zeek", "Suricata", "EDR"]
summary: "Combine network, endpoint, and application evidence instead of assuming one sensor sees inside every connection."
date: "2025-09-11"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

Encryption changes the evidence available to a network sensor. It does not make all monitoring useless, and it does not justify pretending that a packet inspection engine sees application content it cannot decrypt.

## Build a visibility table

For each important service, record where encryption starts and ends, which network paths are observed, and which endpoint or application logs are available.

| Evidence source | Useful question | Important limit |
|---|---|---|
| Network flow | Which endpoints communicated? | Usually no application payload |
| TLS metadata | What handshake details were observed? | Fields vary by protocol and privacy features |
| Endpoint telemetry | Which process opened the connection? | Depends on agent coverage and trust |
| Application audit | Which authenticated operation occurred? | Depends on application logging |

Zeek's [TLS log documentation](https://docs.zeek.org/en/current/reference/logs/ssl.html) describes protocol metadata that may be available. Do not assume every connection exposes a hostname or certificate in the same way.

## Test two observation points

Use a lab application with a known request and a unique harmless marker. Observe the client-to-service encrypted path, then inspect authorized server-side application logs. Identify which source can establish the marker and which can establish only the connection.

If there is an approved TLS termination proxy, document both sides. A sensor after termination may see plaintext traffic for that segment while missing traffic that takes a different route. The presence of a proxy does not establish universal inspection.

Suricata's [HTTP keyword documentation](https://docs.suricata.io/en/suricata-7.0.8/rules/http-keywords.html) describes application buffers used by HTTP rules. A payload rule requiring those buffers cannot be assumed to match opaque encrypted contents.

## Evaluate decryption as an architecture change

TLS inspection introduces certificate trust, private-key protection, application compatibility, and privacy obligations. Establish which traffic classes may be inspected and how the inspection infrastructure is administered. Test certificate-pinned applications and machine-to-machine clients before a rollout.

Do not make “decrypt everything” a substitute for identifying business requirements. Some flows may be better covered by endpoint detection and application audit, especially where interception changes the trust model or breaks the workload.

## Correlate without overstating certainty

Join network and endpoint records using time, addresses, ports, and host identity. Account for NAT and address reuse. A shared egress address can represent many users; it is not a user identifier.

In an analyst exercise, write each conclusion beside its evidence source. “Host A connected to service B” may be established. “User C downloaded file D” may require application audit. Keeping that distinction visible prevents a plausible story from becoming an unsupported incident finding.

## Verify the blind spots

Repeat the fixture when routing, TLS termination, or endpoint tooling changes. Retain a list of unobserved paths and assign owners. A security architecture with documented limits is more actionable than a dashboard claiming complete coverage without a reproducible test.
