---
layout: resource
title: Tools and examples for the research computing lab
seo_title: Tools and examples for the research computing lab
description: Free HPC and AI investigation tools, benchmark records, counter-delta analysis and illustrative NVIDIA GPU and storage scenarios.
nav_section: lab
eyebrow: Wirewalk lab
---

<div class="resource-grid">
<section class="resource-card"><h2><a href="/lab/kubernetes-runai/">Physical nodes, Kubernetes and Run:ai</a></h2><p>Provision the same eight-GPU servers, advertise their resources to Kubernetes, investigate Pod startup and shared storage, and explore Run:ai gang scheduling, quota borrowing and safe node maintenance.</p></section>
<section class="resource-card"><h2><a href="/lab/switching/">Practice switching and fabric operations</a></h2><p>Separate Cumulus/Spectrum-X, Quantum InfiniBand, Juniper QFX and Arista EOS models. Explore eight rails, shared planes, configuration changes, faults and evidence-based repair using the same prepaid account balance.</p></section>
<section class="resource-card"><h2><a href="/lab/cluster-simulator/">Build a virtual BCM-workflow cluster</a></h2><p>Choose Spectrum-X or InfiniBand, eight GPU rails, a bonded access network and Lustre or GPFS. Provision nodes, run jobs and investigate faults. Five-minute trial per verified account; optional prepaid access is $20 per hour. <a href="/lab/access/">Access details</a>.</p></section>
<section class="resource-card"><h2><a href="/lab/walkthroughs/">Watch a narrated investigation</a></h2><p>Captioned scenario overviews of GPU peer paths, rail matching and storage feeding useful GPU work.</p></section>

<section class="resource-card"><h2><a href="/lab/inventory/">Local baseline collector</a></h2><p>Collect a small, read-only Linux, network, RDMA and GPU inventory. No automatic upload.</p></section>
<section class="resource-card"><h2><a href="/lab/counter-deltas/">Counter-delta calculator</a></h2><p>Turn two or more counter samples into rates, with explicit units and reset detection.</p></section>
<section class="resource-card"><h2><a href="/lab/benchmark-records/">Benchmark records and acceptance</a></h2><p>Record the workload, stack, placement, cache conditions and agreed acceptance criteria.</p></section>
<section class="resource-card"><h2><a href="/investigations/">Illustrative investigations</a></h2><p>Walk through GPU ACS, rail matching and storage delivery scenarios.</p></section>
<section class="resource-card"><h2><a href="/samples/">Sample engineering deliverables</a></h2><p>See the structure of an acceptance report, findings report, remediation plan and topology map.</p></section>
<section class="resource-card"><h2><a href="/guides/">Problem-based guides</a></h2><p>Find a short reading path for the symptom your team is seeing.</p></section>
</div>

## Available without a signup

Download the tools, inspect the source and run them locally. These Python tools need Python 3.9 or newer and the standard library. The inventory collector supports Linux hardware views; missing devices or utilities are reported explicitly. The other two tools process local files and do not contact a cluster.

Tools and templates are provided under the [MIT license](/assets/lab-tools/LICENSE.txt). Review generated inventory before sharing it; a baseline can contain operational information even when addresses and unique device identifiers are omitted. No tool runs a benchmark, changes a device setting or uploads a result.

[Download the complete toolkit](/assets/lab-tools/wirewalk-lab-toolkit.zip) · [Read the toolkit README](/assets/lab-tools/README.txt)


[Watch the three narrated walkthroughs](/lab/walkthroughs/). Each has captions and a text transcript.
