---
title: 'RoCE congestion: follow ECN, CNP and pause traffic through one controlled test'
date: 2026-05-11 10:00:00 -0400
category: Fabric
tags:
- RoCE
- ECN
- PFC
- NVIDIA GPUs
summary: Investigate RoCE congestion with matched workload intervals, queue mappings and counter deltas before changing
  thresholds or blaming packet loss.
seo_title: 'RoCE Congestion Debugging: ECN, CNP and PFC Evidence'
description: Investigate RoCE congestion using end-to-end queue mappings, ECN and CNP evidence, PFC counter deltas
  and controlled workload comparisons.
---

A RoCE fabric can pass a clean point-to-point bandwidth test and struggle when many nodes send to one destination. That result is not contradictory. The second workload creates a queueing problem that the first test may never exercise.

To investigate, choose a reproducible traffic pattern and follow its classification and congestion signals from the sender to the receiver. Changing several buffer and threshold settings at once can make a benchmark faster while leaving the cause unknown and another workload worse.

This is a diagnostic workflow for an already designed, supported RoCE deployment. Queue names, counters and control settings depend on the adapter, switch ASIC and software release. It does not supply universal threshold values.

## Draw the traffic's actual path

Record the endpoints, adapters, switch ports, link rates and relevant routing paths. Include the return path used by congestion notifications. For a multi-path fabric, identify whether runs use comparable paths or whether a routing change is part of the experiment.

Write down how packets are marked and classified at every boundary. A sender's traffic class, an on-wire marking and a switch queue are related by configuration; they are not interchangeable names. Confirm the trust policy and mappings rather than inferring them from a VLAN or interface description.

[NVIDIA's Cumulus Linux 5.0 RoCE documentation](https://docs.nvidia.com/networking-ethernet-software/cumulus-linux-50/Layer-1-and-Switch-Ports/Quality-of-Service/RDMA-over-Converged-Ethernet-RoCE/) is a release-specific example of the relationship between congestion notification and priority flow control. Apply the model through the manuals for the installed platform, not copied commands from another switch family.

## Separate the mechanisms you are observing

ECN marking provides congestion information. In a RoCE congestion-control path, receiver-generated CNP traffic helps notify the sender. PFC pauses a priority on a link when its configured condition is reached. The mechanisms act at different points and have different consequences for neighboring traffic.

The useful diagnostic question is how the system responds as offered load rises. Do marked packets and notifications appear? Does the sender's behavior change? Does a queue remain persistently pressured? Are pause intervals short and localized, or does their impact spread?

A pause-frame count alone cannot answer those questions. Interpret the vendor counter: frames, duration, transitions and per-priority accounting tell different stories. Record counter resets and support limitations. Missing telemetry on one hop is a gap in the evidence, not proof that the hop was quiet.

## Capture deltas over the same interval

Take before and after snapshots on relevant endpoints and switch ports using the platform's supported read-only commands. Align the timestamps with application logs. Retain raw snapshots so a later reader can recalculate differences and inspect other fields.

Measure transmitted data, ECN marks, CNP activity, pause behavior, drops, link errors and application throughput where those measurements are available. Separate physical errors from congestion-driven loss. A cable fault and a queue-policy problem can both reduce useful throughput but need different remedies.

Do not clear production counters just to make arithmetic easier. Clearing can erase another team's incident evidence. Counter deltas over a named interval are usually enough, provided that restarts or wraps are identified.

## Move from a quiet baseline to a controlled incast

Begin with one pair to establish connectivity and the expected data path. Then introduce a bounded many-to-one pattern that resembles the production workload. Increase senders in steps while holding message size, placement and duration constant.

Record useful application work and latency distribution, not only total bytes moved. In distributed training, one delayed rank can affect the whole step even when average link utilization looks acceptable. Correlate communication phases with the network interval rather than comparing unrelated dashboard peaks.

Run a comparable unrelated flow where the design permits it. If a congested priority or shared resource harms that flow, the fabric's operating behavior includes that effect. A synthetic test should not be allowed to disrupt production users; schedule the experiment on an agreed subset with a stop condition.

## Interpret combinations rather than single counters

Consider a hypothetical run where throughput flattens as sender count doubles, queue pressure rises and pause duration grows across several upstream ports. That pattern supports investigating congestion propagation. It does not prove which threshold should change or establish that the receiver is healthy.

Check the receiver's ability to consume the workload. PCIe placement, CPU progress, GPU synchronization and application behavior can create a destination bottleneck that no switch adjustment removes. Read the adapter's supported congestion-control configuration as well as the switch policy.

If drops rise without the expected congestion notifications, inspect marking, queue mapping and control-path handling. If notifications rise but throughput oscillates, investigate the complete feedback path and its configuration. Keep these as hypotheses until a targeted experiment distinguishes them.

## Change one supported control and preserve rollback

Save the current configuration and the exact test. Choose one change justified by the observed failure mode, review its effect on shared resources, and use the vendor's supported range and procedure. Buffer allocation changes can affect traffic beyond the test's priority.

Repeat the baseline and stressed cases, including the neighboring workload. A successful change improves the intended behavior without creating a new failure at lower load or on another traffic class. Restore the previous state if evidence is inconclusive.

Keep the test report small enough to use during an incident: path diagram, mapping table, software versions, offered load, interval deltas and application outcome. For the broader architectural comparison, see [InfiniBand and Spectrum-X for MPI](/writing/mpi-infiniband-vs-spectrumx/). The architecture explains available mechanisms; this experiment establishes what one deployed fabric actually did.
