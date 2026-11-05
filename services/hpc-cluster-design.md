---
layout: "service"
permalink: "/services/hpc-cluster-design/"
title: "HPC cluster design and build-out"
seo_title: "HPC Cluster Design & Build-Out"
description: "HPC cluster architecture, provisioning, fabric, storage and scheduler integration for research teams, from a few GPU servers to larger compute environments."
service_id: "hpc-cluster-design"
---

## Plan around the work people need to run

A cluster design starts with the research: applications, datasets, task sizes, software constraints and the time people can afford to wait. I work through those needs with your researchers and IT team before choosing node types or interconnects. That helps distinguish a memory-limited analysis from a communication-heavy simulation or a training job that cannot keep its GPUs fed.

The design brings compute, storage, network, power and cooling requirements into the same plan. Procurement remains in your name. We agree what the system should deliver and how it will be tested, so the purchase can be judged against the work it is meant to support.

## Build the complete environment

Work can include hardware and capacity planning, node classes, operating-system images, provisioning, InfiniBand or RoCE, parallel filesystems, identity integration and scheduler configuration. My experience includes Bright Cluster Manager, OpenHPC, HPCM and xCAT, alongside Slurm, PBS Pro and LSF.

A small deployment still needs a clear path for patching, recovery and replacement. Larger systems need those procedures to work consistently across node classes and shared dependencies. I include administrator documentation and handover in the agreed build-out rather than leaving the team to reconstruct decisions after installation.

## Decide where cloud and hybrid resources fit

Cloud HPC can help when the workload, data location and budget support it. I work with AWS ParallelCluster, EFA and FSx for Lustre, and with Azure HPC, including environments that connect cloud resources with existing equipment.

We consider data movement, identity, software compatibility and recurring cost before committing to a migration. A cloud node that starts successfully is only part of the job; the application must reach its data and produce a result the team can retrieve and validate.

## Agree on acceptance before delivery

The scope identifies representative workloads and the configuration under test. Acceptance may include provisioning and recovery checks, CPU and GPU behavior, communication tests and storage measurements. Results are recorded with the settings needed to reproduce them.

Cluster design and build-out is scoped and quoted per engagement. Hardware, licenses and work outside the accepted scope are agreed separately. If you need help with one layer of an existing system, the fabric, storage, scheduler or benchmark services may be a more focused starting point.
