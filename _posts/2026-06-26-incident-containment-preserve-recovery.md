---
title: "Incident containment: preserve the route you need to investigate and recover"
category: "Recovery"
tags: ["Incident response", "EDR", "Network isolation"]
summary: "Containment decisions should stop harmful activity while preserving evidence and an authorized recovery path."
date: "2026-06-26"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

Disconnecting a compromised system may limit damage, but an unplanned isolation step can also remove the only management route, interrupt evidence collection, or strand a critical dependency. A containment playbook should make those tradeoffs explicit before an emergency.

## Establish authority and scope

Identify who can authorize host isolation, account revocation, storage protection changes, and service shutdown. Keep an incident communication route available outside the systems under investigation.

Record the known facts separately from hypotheses. A suspicious alert may justify precautionary isolation, but the incident record should not claim confirmed compromise solely because a detection fired.

[CISA's ransomware guide](https://www.cisa.gov/stopransomware/ransomware-guide) provides incident-response and recovery guidance. The worksheet below is an operational method for applying those objectives to a specific environment.

## Build a containment decision sheet

| Action | Intended effect | Dependency to preserve |
|---|---|---|
| EDR network isolation | Restrict host communication | Supported responder/management channel |
| Account revocation | Stop further identity use | Independent recovery authority |
| Firewall restriction | Limit affected traffic | DNS, logging, or recovery flows as justified |
| Suspend replication workflow | Avoid propagating harmful state | Existing protected recovery points |

These are possible actions, not automatic instructions. The incident lead selects them based on scope, platform behavior, and business impact.

## Rehearse the endpoint control

For an EDR product such as Microsoft Defender for Endpoint or another deployed platform, use its current vendor procedure on a lab endpoint. Establish which communication remains available during isolation and how authorized responders reverse it.

Do not assume all operating systems or agent versions behave identically. Observe the lab endpoint from a second host, verify the responder path, and time restoration. Record what happens if the agent is unhealthy or the endpoint is already offline.

## Preserve evidence deliberately

Capture relevant timestamps, alerts, host identity, and action records. Decide with the response team which volatile evidence must be collected before disruptive actions. Avoid publishing sensitive logs in a general collaboration channel.

Containment should not trigger uncontrolled cleanup. Deleting files or rebuilding immediately can remove evidence needed to establish scope and root cause. Preserve recovery options while the incident team makes that decision.

## Separate isolation from recovery acceptance

A host can be contained and still be unsafe to reconnect. Establish the criteria for rebuilding or restoring it, rotating exposed credentials, and accepting the recovered application. Confirm the selected recovery point and its dependencies rather than restoring the most recent backup automatically.

Use a tabletop scenario that includes loss of the normal directory and backup console. It reveals whether the procedure depends on the same authority that may be compromised.

## Record outcomes, not just button clicks

Keep the requested action, observed network effect, remaining access, evidence preserved, and restoration result. The product console's “isolated” label should be corroborated by the behavior the team intended.

Continue with [recovery after administrator compromise](/writing/recovery-after-admin-compromise/).
