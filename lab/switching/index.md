---
layout: resource
title: HPC and AI switching labs
seo_title: HPC and AI Switching Labs — Cumulus, Quantum, QFX and Arista
description: Practice eight-rail GPU fabric setup and troubleshooting in separate Cumulus/Spectrum-X, Quantum InfiniBand, Juniper QFX and Arista EOS educational labs.
nav_section: lab
eyebrow: Interactive network labs
no_contact: true
---

A link can be up while a workload still cannot use it. These labs let you follow that gap: inspect a topology, change its configuration, break a dependency, and check the result.

Each lab has eight GPU/HCA rails, two leaf roles per rail and a choice of one, two, four or eight planes. A plane shares two spine roles across its assigned rails. The switch labels refer to a model, not a running vendor image. Port rates and counters are illustrative; they do not predict hardware performance.

<div class="resource-grid">
<section class="resource-card"><h2><a href="/lab/switching/cumulus/">Cumulus / Spectrum-X</a></h2><p>Stage a candidate change, apply it, inspect a BGP or MTU fault, and compare ECN, PFC and queue behavior under synthetic load. Bind the fabric to a matching saved cluster to follow job consequences.</p></section>
<section class="resource-card"><h2><a href="/lab/switching/quantum/">Quantum InfiniBand</a></h2><p>Separate physical link state from logical readiness. Investigate subnet-manager service loss, partition membership, shared-plane failures and credit wait. Bind the fabric to an InfiniBand cluster model.</p></section>
<section class="resource-card"><h2><a href="/lab/switching/juniper/">Juniper QFX</a></h2><p>Practice a QFX5240-inspired fabric with candidate configuration, commit comments, a confirmed-commit timer and rollback. Check RoCE path dependencies before validating the repair.</p></section>
<section class="resource-card"><h2><a href="/lab/switching/arista/">Arista EOS</a></h2><p>Practice a 7060X6 leaf / 7800R4 spine reference fabric. Compare running and startup state, save a change, and test what a modeled restart preserves.</p></section>
</div>

## Use the same prepaid balance

All four switching labs and the cluster lab share your account's existing five-minute trial and $10 prepaid hours. Opening another lab does not create another trial. Saved models are separate; only one session uses time at once. Pause before moving between labs. Reading this guide is free. [Access details](/lab/access/).

## Begin with a small investigation

Launch a fabric, run a collective check, then start one exercise. Read the diagnostic while the fault exists. Repair the relevant setting and run a **new** collective check. A failed check stays failed until you start another; restoring a cable or configuration does not rewrite the result.

The console implements a small documented subset. It never executes a host command. For authentic vendor operating systems, platforms such as NVIDIA Air, vJunos-switch and cEOS/vEOS have their own terms and requirements. They are separate from these Wirewalk models.

[Model assumptions, supported commands and sources](/lab/switching/model/) · [Open the cluster lab](/lab/cluster-simulator/).
