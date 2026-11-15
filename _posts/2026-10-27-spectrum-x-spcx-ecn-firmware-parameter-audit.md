---
title: 'Spectrum-X ECN, firmware and SPC-X parameters: audit the complete applied profile'
date: 2026-10-27 10:00:00 -0400
category: Fabric
tags:
- Spectrum-X
- RoCE
- ECN
- PFC
- Linux
summary: Trace Spectrum-X behavior through switch marking, NIC firmware, runtime QoS and SPC-X algorithm parameters,
  with a versioned inventory instead of a universal tuning script.
seo_title: Spectrum-X ECN, Firmware and SPC-X Parameter Audit
description: Audit Spectrum-X ECN, PFC, NIC firmware and SPC-X congestion-control parameters with versioned profiles,
  effective-state checks and workload evidence.
---

A congestion-control service can be running while the NIC still uses an unintended configuration. A firmware setting can be queued for the next activation while the host reports an older effective state. An ECN counter can rise even though the application uses a different priority from the one the operator meant to qualify.

Build a parameter inventory that connects intended profile, applied state and observed traffic. The objective is to explain one deployed stack completely, not to apply a list of values copied from a different NIC or reference architecture.

Here, SPC-X refers to the Spectrum-X congestion-control package and related configuration. The baseline is the Network Operator 26.1.2 RA2.1 profile and the separate DOCA 3.2.1 management model. These are release-scoped references; do not assume their schemas or support levels are identical. DMS in the cited DOCA release is alpha, with experimental YANG and no supported gNMI streaming subscription in that guide.

## Put every setting into an ownership and lifecycle record

For each field, keep the desired value, source profile, target function, current readback, pending value if exposed, activation requirement and validation result. Include package and firmware identities. Store the raw snapshots privately so a later investigation can inspect fields that were not initially suspected.

Separate these families:

| Family | What the audit must establish |
|---|---|
| Device and firmware | Correct model/PSID, image identity, active revision and activation boundary |
| Port and PCI function layout | Ethernet mode, function count, lane split and plane membership |
| SR-IOV and device exposure | Intended VF count and which consumer receives each resource |
| QoS | Trust, marking, priority-to-traffic-class mapping and PFC behavior |
| Adaptive transport | Routing, retransmission, transmit window and restart policy |
| SPC-X execution | Correct package, algorithm slot, enabled state and counter collection |
| Algorithm parameters | Every supported ID, encoded value and applicable profile variant |
| Switch congestion policy | ECN marking, queue/buffer policy and handling of control traffic |

The [26.1.2 configuration rules](https://docs.nvidia.com/networking/display/kubernetes2612/nic-conf-operator/configuration-details.html) distinguish persistent NIC settings from runtime configuration. Do not infer active runtime state merely from the next-boot firmware column.

## Capture full firmware state before filtering it

On the verified canary host, read-only observations might include:

```bash
pci_bdf=0000:81:00.0
netdev=example0
mlxconfig -d "$pci_bdf" -e q
ethtool -i "$netdev"
mlnx_qos -i "$netdev"
ethtool -S "$netdev"
```

The PCI address and interface are placeholders, not discovery instructions. Keep the complete `mlxconfig` result rather than retaining only lines containing ROCE. Fields affecting parser layout, virtualization or PCI resources can explain why an apparently correct congestion setting is ineffective.

Relevant firmware families include `LINK_TYPE_P1`, SR-IOV enable/count, and mode-specific parser and resource configuration. In the cited RA2.1 profile, hardware-plane handling additionally uses fields such as `ROCE_RTT_RESP_DSCP_P1`, `ROCE_RTT_RESP_DSCP_MODE_P1`, `FLEX_PARSER_PROFILE_ENABLE`, `RDE_DISABLE` and `VF_LOG_BAR_SIZE`. Their desired values belong to the applicable profile, not to a generic Ethernet recipe.

Do not substitute one generation's firmware key for another because the names sound similar. Resolve the installed device's supported fields and the profile's ownership before making a change.

## Audit runtime service and algorithm state separately

Discover the installed service or container rather than assuming a universal unit name. Retain its executable/image identity, launch arguments, configuration source, restart history and logs. Use the installed binary's help and supported status interface to enumerate its actual options.

A process-active check proves process liveness. It does not prove that the desired algorithm is selected, that the relevant priority has RP/NP participation, or that the application exercises the configured path. Inspect the device-side algorithm and counters through the supported interface.

The [DOCA management model](https://networking-docs.nvidia.com/doca/archive/3-2-1/doca-management-service-guide) exposes control families including `user-programmable`, slot enablement, parameter IDs, `adaptive-routing`, `adaptive-retransmission`, `tx-window`, `slow-restart`, `slow-restart-idle`, `rtt-resp-dscp-mode` and `cc-per-plane`. Those are model leaves, not shell commands or promises that every leaf is available on every target.

Record whether an operator, DMS, a service or a local script owns each leaf. Two reconcilers writing the same device can make a setting appear to revert spontaneously.

## Retain every SPC-X parameter, including the quiet ones

The [published RA2.1 profile catalog](https://docs.nvidia.com/networking/display/kubernetes2612/nic-conf-operator/spectrum-x-configuration.html) contains the following slot-zero parameter IDs. This index identifies what to collect; it deliberately does not prescribe one value set for all devices, breakout modes or RA versions.

| ID | Profile parameter |
|---|---|
| 0 | Bandwidth |
| 1 | Responsiveness Alpha Factor |
| 2 | Maximum Decrease Factor |
| 3 | Maximum Increase Factor |
| 4 | Additive Increase Step Size |
| 5 | High Additive Increase Step Size |
| 6 | High Additive Increase Interval Period |
| 7 | Congestion delay threshold in RA2.1 |
| 8 | Maximum Queuing Delay |
| 9 | Rate on First Congestion |
| 10 | Delay Only |
| 11 | CNP Validity |
| 12 | Transmit Rate Decrement Step |
| 13 | Fixed Transmission Rate |
| 14 | Fast Scheduling Factor |
| 15 | Topology Awareness |
| 16 | Advanced Features |
| 17 | Troubleshooting Capabilities |
| 18 | CC_FIXED_CWND |
| 19 | CC Plane Failure Detection |
| 20 | CC Plane Failure Threshold |
| 21 | CC Plane Recovery Threshold |

Do not carry meanings across profiles by ID alone. The same page describes older profiles with a different label for ID 7 and different values elsewhere. Encoded factors are not automatically percentages; bandwidth and timeout interpretations must come from the matched implementation.

Capture all supported parameters and the catalog identity, even if investigating only one threshold. A fixed-rate override or disabled control path can invalidate an otherwise careful experiment. Keep unsupported fields distinct from a valid zero.

## Follow marking and feedback across the complete path

Map application traffic marking to host trust policy, switch queue and receiver processing. Check the feedback path as well as data traffic. Keep RTT-response marking, CNP-related settings and switch ECN thresholds as distinct configuration items; a display label does not prove they have the same scope.

Take interval deltas for bytes, ECN marks, relevant notifications, pause duration, drops and retransmission evidence. Counter names and units depend on the device. Avoid clearing shared counters simply to get a convenient baseline.

The [Cumulus RoCE reference](https://docs.nvidia.com/networking-ethernet-software/cumulus-linux-510/Layer-1-and-Switch-Ports/Quality-of-Service/RDMA-over-Converged-Ethernet-RoCE/) describes switch-side configuration for that release. Linux TCP ECN sysctls do not configure the RoCE NIC/switch feedback loop. PFC activity also needs context: a count alone neither proves a fault nor establishes healthy congestion control.

## Change one supported profile element and measure the result

Use a qualified baseline, bounded contention and the original application interval. Compare quiet and stressed operation, including useful throughput, latency tails and another workload where shared-resource impact matters.

Change one justified element through its owner, preserve rollback and read back the effective result. Re-run after the required reboot or reset, since a runtime-only success can disappear during normal provisioning. Unsupported or opaque internal parameters should remain at the validated profile unless the vendor supplies an appropriate procedure.

Retain the full before/after inventory with the experiment. For the physical and logical mapping behind those measurements, use [Spectrum-X multi-plane setup](/writing/spectrum-x-multiplane-ra21-setup-validation/); for a general counter-driven contention experiment, see [RoCE ECN/CNP/PFC investigation](/writing/roce-congestion-ecn-pfc-investigation/).
