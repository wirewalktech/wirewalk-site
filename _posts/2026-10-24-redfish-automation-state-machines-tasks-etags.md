---
title: "Advanced Redfish automation: discovery, tasks and uncertain outcomes"
date: "2026-10-24 10:00:00 -0400"
category: "Systems Management"
tags: ["Redfish", "DMTF", "BMC", "Automation", "Infrastructure"]
summary: "Build Redfish automation around discovered capabilities, verified identity, asynchronous task tracking, conditional updates and recovery from uncertain request outcomes."
seo_title: "Advanced Redfish Automation: Tasks, ETags and Retry Handling"
description: "Design Redfish automation with resource discovery, asynchronous tasks, ETags and bounded retries, then verify the resulting system state."
---

What should a script do if its connection drops just after it sends a server reset? Retrying may reset the machine twice; assuming failure may leave a real operation untracked. Redfish automation needs a way to reconcile that uncertainty before issuing another change.

The resource model standardizes discovery and operations, but supported actions still vary by hardware and firmware. Record the request, follow any returned task and check what the hardware actually did.

The examples use DMTF's published specification and placeholder addresses. They include read-only discovery, without credentials or executable power-changing requests.

## Discover resources instead of inventing their paths

Begin at the service root and follow returned resource links. Do not assume that the managed system is always `/Systems/1`, that a manager identifier matches a chassis identifier or that every device exposes the same OEM extensions.

A read-only request can use a protected, site-provided curl configuration:

```bash
# The config contains site-managed authentication/TLS settings.
# It must not enable verbose credential logging or insecure TLS bypass.
curl --config "$REDFISH_READ_CONFIG" \
  --connect-timeout 5 --max-time 20 --fail-with-body \
  'https://bmc.example.invalid/redfish/v1/'
```

The `.invalid` address is intentionally non-operational. Validate the management certificate against the site's trust configuration. Do not make `-k` the permanent answer to certificate deployment problems.

Follow collection members and pagination where present. Check the resource type and supported properties before using them. The client's cached inventory should be tied to the discovered device identity and firmware revision.

## Verify the target before any mutation

An IP address can be reassigned. A DNS name can point at a replaced controller. Before changing power, boot configuration or firmware, compare the target's serial number or other stable inventory identity with the approved asset record.

Separate the BMC's state from the host's state. A responsive management controller does not establish that the operating system is running. A powered-on host does not establish that it booted successfully or joined the cluster.

Make the proposed action reviewable: target identity, current state, desired transition, expected disruption and recovery path. Automation should refuse an ambiguous target rather than letting a naming convention stand in for identity verification.

## Model operations as transitions

Represent an operation with explicit states such as planned, submitted, monitoring, completed, failed and outcome-unknown. Store the target identity, request hash, submission time, relevant response headers and task identifiers in a durable operation journal.

An HTTP request completing is one observation. The requested host state becoming true is another. A subsequent workload health check is a third. Keep those outcomes separate in the record.

For power management, define what counts as successful recovery: a fresh boot identifier, operating-system connectivity, required mounts, fabric state and scheduler admission. A successful reset action alone does not establish any of those postconditions.

## Track asynchronous work to a terminal outcome

DMTF [Redfish Specification 1.20.1](https://redfish.dmtf.org/schemas/DSP0266_1.20.1.html) defines asynchronous responses and task-monitor behavior. Preserve the returned `Location` and honor `Retry-After` when provided. HTTP 202 means accepted processing, not completed work.

Poll with a deadline and bounded intervals. Record the task state, status and messages. A task resource and its task-monitor endpoint have related but distinct protocol roles; use the returned URI according to the specification instead of constructing a monitor path from a guessed task number.

Task records may expire. Preserve important final details before they disappear. If a monitor returns an unexpected result after a long gap, reconcile against resource state and retained operation evidence rather than assuming a missing task means success.

## Treat a lost response as uncertainty

A timeout after sending a mutation does not prove the BMC rejected it. The request may have reached the service and the response may have been lost. Blindly replaying a reset, update or account action can create a second operation.

Classify requests by replay risk. Read-only discovery is generally easier to retry than an action with disruptive effects. For mutations, first inspect the operation journal, discovered task state and target resource before deciding whether replay is safe.

Do not invent an idempotency header and assume every BMC honors it. If the interface lacks a supported deduplication mechanism, the client needs reconciliation logic and an explicit outcome-unknown state. Some cases should require an operator to resolve uncertainty rather than continuing automatically.

## Prevent stale configuration updates

Where supported, use the resource ETag with a conditional update to avoid overwriting a concurrent change. If the precondition fails, reread the resource and recompute the intended change. Do not automatically replace the condition with a wildcard and force the write through.

Patch only the properties the operation owns. Preserve unrelated configuration and recognize that some settings are staged for a future reset rather than applied immediately. An accepted settings update can leave current and pending values different.

The action's advertised allowable values and associated ActionInfo resource, when available, are stronger evidence than a payload copied from another manufacturer's example. Validate those capabilities on the actual firmware revision.

## Interpret messages beyond the HTTP status

Keep structured error details and message identifiers, with sensitive values removed. A general HTTP failure can contain a precise explanation about unsupported parameters, privileges, pending operations or required system state.

Resolve messages through the appropriate registry where useful. Do not reduce every failure to a generic retry, and do not suppress a warning merely because the outer request returned a success-class status.

Build test fixtures for supported response shapes, malformed JSON, unavailable resources, throttling, task failure and expired sessions. A client parser should fail clearly when its assumptions are violated. The fixture is a protocol test, not proof that a real server accepted the operation.

## Keep concurrency and credentials bounded

Limit concurrent operations per management controller and per failure domain. BMCs are small systems, and an aggressive inventory sweep can interfere with the management path needed during an incident.

Use scoped accounts and the site's supported secret-delivery mechanism. Protect session tokens, request headers and configuration files. Redact them from operation journals while retaining the nonsecret identity and audit context needed to investigate changes.

Test session expiry and cleanup. An automation service that leaks sessions can eventually make its own management access unreliable. Credential rotation and controller replacement should be supported lifecycle events rather than emergency script edits.

## Verify the intended postcondition

After a successful operation, reread the relevant state and run the independent health checks appropriate to the change. For a boot override, confirm both the configured override and the subsequent boot outcome. For a power action, verify the operating system's recovery before releasing the node.

Leave an unresolved operation visible in the journal until task state or an independent check settles it. During a network failure, that record helps the next operator decide whether to wait, investigate or safely retry.

Read next: [Redfish firmware rollouts for HPC: from inventory to verified readmission](/writing/redfish-firmware-rollout-slurm-admission-gates/), [Management networks: isolate the systems that can rebuild everything](/writing/management-network-bmc-isolation/).
