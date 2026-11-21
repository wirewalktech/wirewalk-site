---
title: A public lab for the systems behind research
date: '2026-11-20T22:05:50-05:00'
category: Lab notes
tags:
- HPC
- NVIDIA GPUs
- Research computing
- Tools
summary: Problem-based guides, local tools, sample reports and illustrative GPU and storage investigations, available without a signup.
seo_title: A Public Lab for HPC and AI Infrastructure
description: 'Explore Wirewalk’s public HPC and AI lab: problem-based guides, local tools, sample engineering reports and narrated GPU and storage scenarios.'
---

The [Wirewalk lab](/lab/) brings together resources for the people trying to make research systems useful. You can start with a symptom, download a small tool or look at the kind of report an investigation should leave behind. There is no signup required.

## Start with the problem you have

A long article library is useful when you know what to look for. When you do not, a shorter route helps. The [problem guides](/guides/) cover waiting GPUs, distributed jobs that hang or scale poorly, inconsistent storage performance and acceptance of a new cluster. Each connects an initial question to detailed articles and a bounded next experiment.

## Use a small tool locally

The [baseline collector](/lab/inventory/) records a limited local inventory. The [counter calculator](/lab/counter-deltas/) turns continuous samples into rates with explicit units, retaining large integer inputs and rejecting reset intervals. The [run-record template and validator](/lab/benchmark-records/) help keep the workload, placement, software and acceptance question with a result.

These are deliberately modest tools. They do not change device settings, run a benchmark or upload results. Their documentation explains what a successful check establishes and what remains unverified. The supplied fixtures are synthetic; their calculated rates are not hardware benchmarks.

## Follow a scenario without mistaking it for a customer result

Three constructed investigations cover [GPU peer traffic and ACS](/investigations/gpu-acs-peer-traffic/), [GPU-to-NIC rail matching](/investigations/gpu-rail-matching/) and [storage feeding useful GPU work](/investigations/storage-feeding-gpus/). They show hypotheses, evidence, decision points and operating handover. They do not claim a measured production improvement.

Each also has a short [narrated walkthrough](/lab/walkthroughs/), with captions and a transcript. The narration uses a computer voice; the detailed scenario carries the technical qualifications.

## See what the work should leave behind

The [sample deliverables](/samples/) show an acceptance report, findings report, remediation plan and topology. They are fictional formats, available as readable pages and downloads. A real engagement should tie its conclusions to actual evidence, identify unresolved limits and give the operating team a supported way forward.

The [procurement guide](/procurement/) explains how scope, access, purchase orders and handover fit together. You can also [print a capabilities overview](/capabilities/) to share with your team.

I want these resources to help researchers and administrators choose the next useful check, whether they do the work themselves or bring in help. The useful outcome is a system people can depend on to get their research done.
