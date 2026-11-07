---
title: 'Redfish telemetry: keep hardware identity, units and sample freshness together'
date: 2026-03-05 10:00:00 -0500
category: Infrastructure Management
tags:
- Redfish
- Monitoring
- Linux
- HPC
summary: Build read-only Redfish collection around resource discovery, sensor identity, timestamps and explicit
  missing-data states, then validate it against scheduler and node observations.
seo_title: 'Redfish Telemetry: Hardware Identity, Units and Freshness'
description: Build reliable Redfish telemetry with resource discovery, stable hardware identity, units, sample timestamps
  and explicit handling of missing readings.
---

A management controller can answer an HTTPS request while the operating system is unresponsive. It can also return a report whose measurements were collected earlier than the request. Both facts make Redfish useful, and both make simplistic health checks misleading.

A reliable collector needs to retain the relationship between a chassis, a component, a measurement and its observation time. The dashboard should show uncertainty when that relationship is missing. It should not turn a missing sensor into a temperature of zero or treat an old power sample as current load.

This article concerns read-only telemetry. Changing firmware settings, creating subscriptions or controlling power belongs in a separately authorized management workflow.

## Discover resources instead of guessing member names

Start at the service root and follow the advertised collections. System and chassis identifiers vary between implementations, as do the relationships between them. A hard-coded path copied from one BMC can work across a small fleet and then quietly omit a new hardware family.

Record the controller's supported schema versions and which resources it actually exposes. Redfish standardization does not mean every optional service or sensor exists on every device. Treat an absent TelemetryService as a capability result, not automatically as a failed server.

The [DMTF Redfish resource guide for the 2020.1 schema bundle](https://redfish.dmtf.org/schemas/DSP2046_2020.1.html) provides an established reference for resource structure. Use the implementation's declared schema and vendor documentation when deciding which properties are available.

## Maintain a hardware inventory outside the graph

Map management endpoints to physical systems using stable inventory evidence such as serial numbers and component relationships. Keep the mapping under review when a board, controller or chassis is replaced. An IP address can be reassigned; it is not permanent hardware identity.

Store enough context to distinguish a chassis power reading from a CPU or GPU component reading. A display label such as `Power` is not an adequate key when several resources use it. Preserve the resource URI and the relevant identity alongside the human-readable label.

Do not put credentials into metric labels, log URLs or screenshots. Use the approved secret store and TLS trust configuration. A read-only collector still has access to infrastructure details that should not be publicly exposed.

## Distinguish collection time from report arrival

Retain the timestamp associated with each metric value where provided, the report timestamp and the collector's receipt time. Their meanings can differ. Do not replace the sensor's time with the moment an HTTP request completed and then claim a fresh observation.

The [DMTF Telemetry white paper](https://www.dmtf.org/sites/default/files/standards/documents/DSP2051_1.0.1.pdf) describes report definitions and metric values. Read the definition as well as the report: a value may summarize an interval or be generated according to a reporting policy rather than representing an instantaneous sensor read.

For a hypothetical report, the collector might receive data at 12:05 while a metric's observation timestamp is 12:01. A four-minute age may be acceptable for inventory trending and unsuitable for a rapid thermal alert. Freshness policy should follow the operational use, with clock uncertainty considered explicitly.

## Carry units and scope through every transformation

Normalize units only with a documented conversion. Retain the original value and unit in troubleshooting evidence when practical. A number copied into a generic `power` series without identifying watts, aggregation scope and interval is difficult to interpret later.

Determine whether the reading is instantaneous, averaged, cumulative or a limit. Summing average chassis power readings over time without accounting for interval length does not produce an energy value. Summing overlapping chassis and component readings can double-count the same consumption.

Validate a few samples against the BMC's own supported interface and a known controlled workload. Agreement will not establish laboratory measurement accuracy, but it can expose unit conversion, resource-mapping or parser errors.

## Represent missing and failed data explicitly

Distinguish unsupported properties, absent components, stale samples, authentication failure, transport failure and valid zero values. These states call for different responses. A dashboard should let a responder tell whether the sensor reported something unusual or the collector stopped receiving evidence.

Test malformed and partial responses with local fixtures. Preserve unknown fields where the parser needs them for forward compatibility, but validate the fields used in decisions. An empty array should not pass a check merely because its HTTP response was successful.

Bound polling and retries. A fleet collector that retries every missing reading immediately can overload slow controllers during an incident. Use a reasonable schedule and backoff, and measure controller responsiveness before increasing collection frequency.

## Join telemetry with node and scheduler evidence

A chassis reporting normal power does not establish that Slurm can start a job. Conversely, a job waiting in the queue does not imply a hardware fault. Keep management-controller observations, OS health and scheduler state as distinct evidence streams with a shared identity map.

For NVIDIA systems, use host GPU telemetry where appropriate rather than assuming the BMC exposes every accelerator detail. Check that the host and BMC observations refer to the same device and time interval before presenting them together.

Make the alert describe the evidence it has. A stale BMC reading should trigger a collection or management-path investigation; it should not be mislabeled as a measured thermal emergency. Automatic drain or power action requires an additional policy with its own validation and recovery behavior.

## Test lifecycle changes before fleet rollout

On a representative maintenance system, check behavior across an OS reboot, a BMC restart and a temporary collector outage. Record which identities persist, how timestamps behave and when readings become available again. Keep those observations specific to the tested hardware and firmware.

Then add a second hardware family before assuming the parser generalizes. A small compatibility matrix is more useful than a collector that silently skips unfamiliar resources.

For actions that change system state, see [Redfish automation state machines](/writing/redfish-automation-state-machines-tasks-etags/). Reliable telemetry supports those decisions, but a sensor report should never be treated as permission to perform them.
