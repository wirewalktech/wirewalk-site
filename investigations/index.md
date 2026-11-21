---
layout: resource
title: Investigations and illustrative lab scenarios
seo_title: Investigations and illustrative lab scenarios
description: Detailed HPC and AI lab scenarios covering GPU ACS peer traffic, physical rail matching and storage that keeps training supplied.
nav_section: lab
eyebrow: Follow an investigation
---

<div class="resource-grid">
<section class="resource-card"><h2><a href="/investigations/gpu-acs-peer-traffic/">GPU peer traffic and ACS</a></h2><p>A constructed investigation of upstream PCIe redirection, platform isolation and controlled GPU peer tests.</p></section>
<section class="resource-card"><h2><a href="/investigations/gpu-rail-matching/">Match GPUs to physical rails</a></h2><p>A constructed multi-node investigation in which matching NIC numbers does not mean matching the physical fabric.</p></section>
<section class="resource-card"><h2><a href="/investigations/storage-feeding-gpus/">Feed GPUs from shared storage</a></h2><p>A constructed investigation separating metadata, read delivery, transforms and checkpoint interference.</p></section>
</div>

## What these examples represent

These scenarios were constructed to show the decisions and deliverables involved in an investigation. They are not customer case studies, testimonials or records of measured production improvements. Example output and diagrams are labeled where shown. Actual work starts from the installed system and an agreed test plan.

For longer documented methods, read the existing notes on [fabric limits behind a storage read ceiling](/writing/when-storage-is-actually-the-fabric/), [GPFS multihomed client reachability](/writing/gpfs-multihomed-storage-arp-source-routing/) and [measuring unnecessary work in a research pipeline](/writing/ninety-seven-percent-of-the-work-was-unnecessary/). Their stated scopes and limits remain important; these new scenarios add no new measured outcome to those records.

[See sample reports](/samples/) · [Use the public tools](/lab/) · [Find a problem guide](/guides/)
