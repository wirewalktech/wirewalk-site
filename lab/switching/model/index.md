---
layout: resource
title: Switching lab model and operating guide
seo_title: Switching Simulator Guide — Eight Rails, Planes, RoCE and InfiniBand
description: Learn how Wirewalk’s switching labs model shared GPU fabric planes, configuration workflows, RoCE and InfiniBand faults, exercises and cluster-job dependencies.
parent_url: /lab/switching/
parent_title: Switching labs
nav_section: lab
eyebrow: Assumptions and commands
no_contact: true
---

[Choose a switching lab](/lab/switching/). These are independent educational models. They do not run Cumulus Linux, MLNX-OS, OpenSM, UFM, Junos, EOS or a vendor ASIC. A completed exercise establishes that the modeled dependencies passed; it is not hardware acceptance evidence or a vendor qualification.

## Understand the topology before changing it

Each rail has two leaf roles, representing two rack-side groups. Each leaf connects to spine A and spine B in its assigned plane. Rails are assigned to planes in round-robin order. With two planes, rails 1/3/5/7 share one spine pair and rails 2/4/6/8 share the other. Eight planes give each rail its own pair.

One leaf uplink loss leaves one eligible cross-rack path. Losing both uplinks on the same rack side blocks that rail. A spine interruption affects every rail using that plane; losing its partner can block all those rails. The model assumes redundant paths but does not implement real routing convergence, packet reordering or transport failover timing.

The path diagram shows physical administrative availability. The state text also checks logical configuration. A green line in the diagram can coexist with a blocked rail when its MTU, BGP plan, membership or rail identity is wrong.

Ethernet profiles require a modeled workload MTU of 9000 bytes and begin at 9216. This is a simplified common threshold, not a universal instruction to give every switch and host the same numeric MTU: real platforms count Ethernet framing and IP payload differently. InfiniBand starts at a 4096-byte reference MTU. Reference rates are 400 or 800 Gb/s; no calculation turns them into promised throughput.

## Cumulus / Spectrum-X workflow

Select `leaf-r1a`. Change MTU to 1500 in Configuration. The candidate changes; the running fabric remains healthy until apply. Inspect the difference, apply, then check the rail status. Restore 9216 and apply again.

The finite console equivalent is:

```console
nv config diff
nv set interface swp1 link mtu 1500
nv config apply
nv show interface
nv set interface swp1 link mtu 9216
nv config apply
nv show router bgp
```

These commands act on one selected-switch teaching scope. `swp1` is a lab alias for that scope, not a complete port map or NVUE object tree. Diagnostic output is an explicitly synthetic fabric summary, not a captured switch transcript. This profile follows the Cumulus 5.14 default of automatically saving on apply; `nv config save` is also supported. It does not implement every NVUE revision or configuration option.

A BGP path in this model requires enabled BGP and each involved switch ASN to match the fixed reference peer plan displayed in Configuration. This illustrates an inconsistent ASN change. It does not exchange BGP packets, calculate real routes or support arbitrary coordinated neighbor reconfiguration. EVPN/VXLAN, MLAG, adaptive routing, NIC congestion control and the full Spectrum-X software stack are outside the current model.

## Quantum InfiniBand workflow

Launch the Quantum profile and inspect `sminfo`, `ibstat` and `ibdiagnet`. Disable the primary SM service host. Its standby takes the displayed role; logical readiness waits through a three-tick teaching recovery interval. Disable both and compare the model's INIT state with still-up physical host links.

Each independent plane is treated as a separate subnet. The two service hosts represent one SM instance per plane; the GUI changes all instances on a service host together, so the same host wins each plane's modeled election. This is a service-level simplification, not one SM spanning disconnected subnets. Individual per-plane SM configuration, real GUID discovery and LID assignment are not implemented. Higher configured priority wins; equal priorities use the fixed lower-identity host role. No real election or sweep duration is predicted. The model conservatively gates logical readiness on an available SM service; a real established fabric may retain forwarding during some SM outages.

P_Key controls represent administrator/SM policy. For rail 1, set both host-side memberships to `0x1234`: both are limited members of partition `0x1234`, so communication is blocked even with links up. Change one to `0x9234`: its high bit grants full membership, allowing the modeled full-to-limited pair. Different partition numbers still fail. This is membership matching, not a complete partition table, switch enforcement or security implementation.

```console
sminfo
ibstat
iblinkinfo
ibqueryerrors
ibdiagnet
```

The commands return short synthetic summaries. Ethernet PFC and ECN counters are not applied to InfiniBand. Its credit-wait counter uses a separate illustrative rule; no virtual lanes, arbitration tables, SHARP offload, adaptive routing or packet-level credit accounting are emulated.

## Juniper QFX workflow

The reference is a QFX5240-class AI fabric. Stage a candidate MTU change, inspect it and use a commit with the lab's fixed comment. A confirmed commit lasts **60 logical ticks** in this exercise. Pause stops that model clock; increasing model speed advances it faster. This differs from an actual device's wall-clock timeout.

```console
set interfaces et-0/0/0 mtu 1500
show | compare
commit confirmed 1 comment lab
show interfaces terse
```

Let the timeout expire and inspect the rollback. Alternatively, confirm with `commit comment lab`. `rollback 0` discards pending changes. `rollback 1` loads the previous running configuration into the candidate; it does not activate it until committed. Only one previous revision is modeled. The interface name addresses the selected-switch teaching scope, not all physical ports. Complete Junos syntax/modes, arbitrary comments, commit scripts and device reboot behavior are outside the exercise.

## Arista EOS workflow

This reference uses 7060X6 leaf and 7800R4 spine roles. Changes affect running state immediately. Use the finite interface sequence:

```console
configure terminal
interface Ethernet1
mtu 1500
end
show running-config
show startup-config
copy running-config startup-config
```

A modeled restart restores startup. Compare an unsaved change with a saved one. `Ethernet1` addresses the selected-switch teaching scope. Other configuration settings are available through the GUI; the model does not implement the full EOS parser, privilege system, routing agents or hardware pipeline. Newer Arista platforms exist, including the announced 7060XE7 family; this lab deliberately names its narrower reference rather than claiming to emulate the whole current portfolio.

## Read congestion counters carefully

Use the Congestion exercise or set offered load above 70%. In the Ethernet teaching rule, enabled ECN limits queue growth and increments a synthetic marking counter. With ECN disabled, the queue can grow; PFC settings influence synthetic pause/drop counters. These coefficients and thresholds are chosen for a visible exercise. They are not switch buffer sizes, recommended ECN thresholds, actual PFC headroom calculations or proof that any profile is lossless.

The pause-storm exercise disables the selected leaf's modeled watchdog. Restoring the watchdog permits a three-tick synthetic recovery. Real watchdog actions and their traffic-loss consequences vary by platform and configuration. Use vendor documentation and measurements for a deployment.

Event counters are cumulative. The queue percentage is a gauge and can fall after repair. “Restore reference configuration” preserves counters and a failed collective result. It repairs the running reference configuration, not every saved startup copy; EOS startup changes still need an explicit save.

## Complete an exercise with evidence

1. Run a baseline collective check and note its result.
2. Start an exercise for one rail or interrupt a shared device.
3. Inspect the relevant supported diagnostic while the problem exists. The GUI's diagnostic summary is also available through `sim observe`.
4. Repair the affected running configuration or dependency.
5. Start a new collective check. The exercise is complete only after diagnosis, repair and a fresh passing check.

Repairing first and observing a healthy fabric does not earn the diagnosis step. A previously failed result remains failed. The model's collective check requires all eight rails; a single-path rail progresses more slowly under its teaching coefficient. This does not promise how a real NCCL, MPI or RDMA application would recover.

Wirewalk helpers are clearly separate from vendor commands:

```console
sim observe
sim probe
sim repair
sim step 30
sim load 95
```

Unsupported input is not evaluated. The console cannot invoke SSH, a shell, network discovery or an external service.

## Connect a NVIDIA fabric to the cluster model

Use “Bind to cluster model” in Cumulus or Quantum. It binds to a matching saved cluster, or creates a four-node Lustre reference cluster if none exists. A mismatched saved cluster is preserved and binding is refused. Export it before choosing to rebuild.

The bound fabric owns the cluster's EW rail availability. When that rail becomes logically unavailable, the cluster's conservative dependency model can fail an active collective on its next tick. Repair the fabric, then explicitly requeue the failed cluster job; a repair never marks it complete. The bridge carries binary rail eligibility, not switch throughput, queue occupancy or ECN/PFC timing. A single remaining path is eligible. Storage and NS faults remain in the cluster model.

A bound fabric and cluster advance together while either linked lab is active. Other saved vendor models stay paused. Billing counts one active session, not two. Rebuilding/importing a cluster detaches its old fabric binding. Detaching a fabric leaves the cluster's last rail-fault states for explicit repair. Juniper and Arista currently run as separate labs; their architectures are not mislabeled as Spectrum-X by a bridge.

## Account time and session files

The same five-minute account trial and $10 prepaid hours cover the cluster and four switching labs. There is no new trial per platform. Pause freezes mutation controls and stops account usage; disconnect detection can use up to four seconds. Saved states are separate per platform, while the time balance is server-owned and shared. [Access details](/lab/access/).

Export contains topology, configuration and counters, not credentials or credit. Import validates platform, topology, link flags, membership, numeric bounds and configuration. It resets exercise/probe progress, CLI modes and live confirmed-commit deadlines, then pauses. A session from another vendor profile must be opened in that profile. Neither import nor a model-clock change adds account time.

## Sources and scope

Reviewed November 21, 2026. These primary sources support the concepts and named reference platforms. Wirewalk's topology sizes, thresholds, timing, synthetic outputs and exercise scoring are our own disclosed assumptions.

- [NVIDIA Cumulus 5.14 quick start](https://docs.nvidia.com/networking-ethernet-software/cumulus-linux-514/Quick-Start-Guide/) and [NVUE configuration management](https://docs.nvidia.com/networking-ethernet-software/cumulus-linux-514/System-Configuration/NVIDIA-User-Experience-NVUE/NVUE-CLI/).
- [NVIDIA NVUE interface commands](https://docs.nvidia.com/networking-ethernet-software/nvue-reference/Set-and-Unset-Commands/Interface/) and [Cumulus 5.15 quality of service concepts](https://docs.nvidia.com/networking-ethernet-software/cumulus-linux-515/Layer-1-and-Switch-Ports/Quality-of-Service/). These are not a promise of complete syntax compatibility across releases.
- [NVIDIA InfiniBand partition membership and SM election concepts](https://networking-docs.nvidia.com/nvidiainfinibandsecurityoverviewandguidelines/security-in-infiniband) and [diagnostic utility roles](https://networking-docs.nvidia.com/winofdocumentation/55054000/infiniband-fabric-diagnostic-utilities).
- [Juniper QFX5240 system overview](https://www.juniper.net/documentation/us/en/hardware/qfx5240/topics/topic-map/qfx5240-system-overview.html), [RoCEv2 on QFX platforms](https://www.juniper.net/documentation/us/en/software/platform/qfx5220-qfx5230-qfx5240-qfx5241-qfx5250-configuration-essentials/qfx-configuration-essentials/topics/task/ROCEv2.html), [commit behavior](https://www.juniper.net/documentation/us/en/software/junos/cli/topics/topic-map/junos-configuration-commit.html) and [rollback](https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/rollback.html).
- [Arista 7060X6](https://www.arista.com/en/products/7060x6-series), [AI networking portfolio](https://www.arista.com/en/solutions/ai-networking/media) and [EOS configuration files](https://www.arista.com/en/um-eos/eos-configuration-files).
- [NVIDIA's current Cumulus VX/Air guidance](https://docs.nvidia.com/networking-ethernet-software/cumulus-vx/), [Juniper vJunos-switch](https://www.juniper.net/documentation/us/en/software/vjunos/vjunos-switch-kvm/topics/vjunos-switch-overview-understanding.html) and [Arista lab-image options](https://arista.my.site.com/AristaCommunity/s/article/understanding-eos-software-download-options) describe separate vendor software paths. No vendor image or license is distributed here.
