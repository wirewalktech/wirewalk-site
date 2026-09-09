---
title: "Zeek: turn a connection into an investigation trail"
category: "Detection"
tags: ["Zeek", "Network telemetry", "DNS", "TLS"]
summary: "Use connection identifiers to connect evidence while keeping the limits of passive visibility explicit."
date: "2025-07-01"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

A network alert becomes more useful when an analyst can establish what happened immediately before and after it. Zeek supplies protocol and connection context that can support that investigation, even when a signature alone gives little explanation.

## Begin with a known capture

On a host with Zeek installed, process an approved synthetic PCAP from a clean output directory:

```bash
mkdir -p ./zeek-lab-output
cd ./zeek-lab-output
zeek -r ../approved-test.pcap LogAscii::use_json=T
```

This writes local logs. It does not send traffic or validate the location of a production sensor. Zeek documents the workflow in its [quick start](https://docs.zeek.org/en/v8.2.1/quickstart.html).

Choose a fixture whose endpoints and expected protocols are known. A large unexplained capture is a poor first test because it makes missing evidence difficult to recognize.

## Follow one connection

Inspect a compact view of JSON connection records:

```bash
jq -c '{uid,origin:."id.orig_h",destination:."id.resp_h",
  port:."id.resp_p",proto,service,duration}' conn.log
```

The [connection-log reference](https://docs.zeek.org/en/current/reference/logs/conn.html) explains the fields and the connection UID. Use the UID to locate related protocol records where that field is present. Preserve sensor identity and time context when combining records from multiple systems.

Ask a specific question: did this host query a name and then connect to an unexpected service? The DNS answer and the subsequent destination can support a hypothesis. They do not prove that the same process or user caused both actions without additional endpoint evidence.

## Know what encryption removes

TLS can leave useful connection and handshake metadata while hiding application contents. Visibility varies with protocol and configuration. A missing HTTP log for an encrypted connection is not, by itself, a sensor failure.

Likewise, traffic that never traverses the observation point cannot appear in the logs. Capture loss, asymmetric routing, and mirror oversubscription can create partial records. Investigate those conditions before interpreting absence as proof that communication did not happen.

## Build a repeatable analyst exercise

Prepare a small scenario containing a DNS lookup, an allowed web request, and a connection to a lab-only destination. Ask a second operator to reconstruct the sequence using the logs and the documented queries. Record which claims can be established and which require endpoint or identity records.

Then repeat on the live monitored path using approved harmless traffic. Verify that the logs reach the analyst's system within the agreed window and remain queryable after rotation.

## Avoid turning metadata into certainty

A large transfer is not automatically exfiltration. A new destination is not automatically malicious. Use inventory, business purpose, endpoint process information, and access records to test the hypothesis.

A useful deployment delivers dependable context and explicit blind spots. See [encrypted traffic visibility](/writing/encrypted-traffic-detection-boundaries/) for the complementary sensor-placement review.
