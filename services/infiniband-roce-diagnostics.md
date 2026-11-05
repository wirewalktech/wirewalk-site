---
layout: "service"
permalink: "/services/infiniband-roce-diagnostics/"
title: "InfiniBand, RoCE and Ethernet diagnostics"
seo_title: "InfiniBand, RoCE & NCCL Diagnostics"
description: "InfiniBand, RoCE and Ethernet diagnostics covering link health, routing, congestion, NVIDIA UFM, RDMA paths and NCCL communication for agreed workloads."
service_id: "infiniband-roce-diagnostics"
---

## Investigate one agreed compute network

The diagnostic covers an agreed InfiniBand, RoCE or Ethernet TCP/IP network. We identify the affected applications, node groups, traffic patterns and test window before collecting a baseline. That keeps the investigation tied to a real symptom instead of producing a large inventory with no clear next action.

Checks can include negotiated speeds and widths, cables and optics, switch paths, inter-switch balance, congestion, adapter placement, firmware and drivers. I compare affected and unaffected paths and retain the node lists with the results. A clean link between two machines may not explain what happens when a full allocation communicates at once.

## Check the protocol-specific behavior

InfiniBand work includes subnet management and routing. RoCE work can include flow control, PFC, ECN and the configured RDMA transport. On Ethernet TCP/IP, the checks follow the connection path and workload without assuming RDMA is involved.

For InfiniBand environments using NVIDIA UFM, the service can include configuration review and agreed tuning of monitoring, alerts, subnet management and supported routing or congestion settings. The written scope names the changes that are authorized and the measurements used to assess them.

## Include GPU communication when it matters

GPU workloads can be tested with selected NCCL collectives, including all-reduce and all-gather, as well as GPU-to-GPU and multi-node communication. Where supported, I check GPUDirect RDMA and look for unintended TCP fallback.

Tests progress from individual paths to the relevant concurrent workload. Results include the software stack, message sizes, placement and counter intervals. This makes it easier to distinguish a hardware path problem from application layout or communication-library configuration.

## Leave findings the team can act on

The engagement includes a baseline, controlled tests, prioritized findings and a readout, together with agreed UFM tuning where applicable. Other remediation, software licenses, travel and ongoing support are quoted separately.

You can book the diagnostic after a brief qualification call; a paid architecture assessment is not a prerequisite. Written acceptance confirms system size, workloads, access, test window and delivery date. Prices and procurement options are maintained on the ordering page.
