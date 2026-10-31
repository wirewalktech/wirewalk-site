---
title: "Feeding NVIDIA training GPUs: data staging, preprocessing, and correct datasets"
date: "2024-07-17 10:00:00-04:00"
category: "AI Infrastructure"
tags: ["NVIDIA", "Training Data", "Storage", "DALI", "GPUDirect Storage"]
summary: "Design a training input path that keeps NVIDIA GPUs supplied while preserving point-in-time correctness, dataset versions, host-memory limits, storage capacity, and recovery behavior."
description: "Design a training input path that keeps NVIDIA GPUs supplied while preserving point-in-time correctness, dataset versions, host-memory limits, storage capacity, and recovery behavior."
---

A GPU cluster can wait on a training dataset that appears small enough for its storage system. Millions of file opens, CPU decoding, repeated remote reads, and poorly placed staging processes can keep the accelerators idle. A faster loader can also deliver the wrong data faster if historical joins leak future information.

The infrastructure design must satisfy both throughput and dataset correctness. Treat ingestion, curation, staging, preprocessing, and device transfer as a measured pipeline with an immutable dataset contract, rather than a directory mounted into a training container.

## Budget the path from source storage to device memory

Measure source discovery, open latency, read throughput, decode time, host-to-device transfer, and time waiting for the next batch. Use the actual file-size distribution and augmentation policy. A sequential storage benchmark cannot stand in for a loader opening small compressed objects across many workers.

Plan host RAM for loader processes, decoded batches, prefetch queues, and pinned transfer buffers. Multiply by concurrent jobs on the node. More loader workers can increase throughput until they saturate CPUs, memory bandwidth, the metadata service, or the source; beyond that point they can make every job slower.

A proposed staging policy is to copy a versioned dataset shard to node-local NVMe, validate it against its manifest, and reuse it for the allocation's lifetime. Record which copy is authoritative and what a node failure or reimage removes. Reserve scratch for both staged input and checkpoints rather than allowing one to exhaust the other.

## Select NVIDIA data-path tools for the measured bottleneck

NVIDIA DALI is a candidate for supported decoding and preprocessing operations. Its presence in the [NVIDIA PyTorch 24.04 container](https://docs.nvidia.com/deeplearning/frameworks/pytorch-release-notes/rel-24-04.html) establishes an available historical software option. It does not establish that arbitrary Python feature engineering or tokenization automatically moves onto the GPU. Compare a representative loader with and without the proposed preprocessing path.

GPUDirect Storage is a separate option for compatible storage-to-GPU transfers through a cuFile-aware application. The [CUDA 11.4 GDS overview](https://docs.nvidia.com/cuda/archive/11.4.0/gds/overview-guide/index.html) describes the direct path and compatibility behavior. Validate the filesystem, driver, device topology, and application integration before claiming the CPU staging path was bypassed. A normal filesystem mount alone does not provide that integration.

For either option, compare useful samples or supervised tokens per second, CPU load, device idle gaps, and storage traffic. Preserve decoded sample checks and the temporal dataset rules below. Acceleration changes how inputs arrive; it does not establish that those inputs were valid at prediction time.

## Define prediction time before writing joins

Consider an illustrative maintenance model that predicts whether a machine will fail in the next seven days. Each training row needs a machine identifier, a prediction timestamp, a feature history cutoff, and a label window. A repair code recorded three days after the prediction belongs to the outcome history. It cannot become an input merely because it is now present in the same database.

Define whether the system makes one prediction per machine per day, per shift, or per observed event. That choice determines which records are eligible, how overlapping examples are handled, and how often an operator would receive an alert. A dataset of handpicked incidents answers a different question from a dataset of all actual decision opportunities.

Write these definitions in the dataset contract. A field named `date` is inadequate when it could mean event occurrence, ingestion, correction, or warehouse refresh.

## Preserve event time and knowledge time

An event can occur before a prediction and still arrive too late to be usable. For each source, distinguish when the event happened from when the relevant system received it. Preserve correction history where possible.

A historical feature should obey both constraints:

```text
source.event_time <= prediction_time
source.available_at <= prediction_time
```

For rolling features, also enforce the lower bound of the chosen lookback window. Use a documented inclusive or exclusive boundary so that an observation arriving at precisely the cutoff is handled consistently.

The simple pair of predicates is a design sketch, not a complete temporal database implementation. If a source row can be corrected, select the latest version available at the cutoff rather than the latest version today. A correction that moves a payment or sensor reading backward in event time can otherwise contaminate an entire historical dataset.

## Join aggregates at the correct grain

A common leak appears in group-level features: average customer spend, neighborhood failure rate, or supplier reliability is calculated across the complete dataset and then joined onto earlier rows. The aggregate includes later outcomes, sometimes including the row's own target.

For each aggregate, record its entity keys, source interval, availability lag, and minimum sample requirement. Calculate it using the same historical restriction as the raw inputs. Decide what to return for an entity with no earlier history; a value fitted using future observations is not a legitimate missing-value fallback.

Check join multiplicity before training. A one-to-many join can silently duplicate positive events and change the label distribution. Compare counts, unique decision keys, and null rates before and after every major join. Make intended multiplicity an assertion rather than a comment.

## Split by the dependency that matters

Random row splitting is appropriate only when the independence assumption fits the task. Repeated measurements of one person, machine, document family, or customer often make rows dependent. Put related records into the same fold when the goal is to generalize to new entities.

For forecasting, preserve time order. Consider a gap between training and validation when label windows overlap or when adjacent observations expose nearly identical histories. For a seven-day outcome, training examples immediately before the cutoff may have outcomes extending into the validation period. Specify whether those examples are excluded or whether label availability is delayed.

A time split and an entity split test different generalization questions. Evaluate both if deployment includes both future records from known machines and records from newly installed machines. Do not combine them into one score and lose the distinction.

## Fit preprocessing within the training boundary

Imputation values, scaling parameters, selected features, encodings, and dimensionality reduction can all leak information when fitted on the full dataset. Fit them on the training portion of each fold, then apply the fitted transform to validation data. The [scikit-learn 1.4 pitfalls guide](https://scikit-learn.org/1.4/common_pitfalls.html) documents preprocessing leakage and the use of pipelines to keep fitted operations inside the appropriate split.

Target encodings require extra care because the transform itself uses labels. A training row's encoded value should not simply reveal its own label through a small group average. Use an appropriate out-of-fold construction within the training set and preserve the distinction between training-time and serving-time lookup behavior.

Inspect less obvious inputs too: filenames containing diagnosis codes, document templates introduced after an outcome, and identifiers assigned in chronological order. A high feature importance can be a clue to a broken dataset rather than an insight into the domain.

## Treat labels as versioned data

A missing outcome is not always a negative outcome. A machine installed yesterday has not completed a seven-day observation window. A transaction under investigation may not have a final classification. Record maturity rules and keep censored examples out of a fully observed target unless the modeling method explicitly handles censoring.

Track when labels become available and when they are revised. Rebuild evaluations when meaningful corrections arrive, while retaining the original dataset version so that an old result remains explainable. A changing label definition is a change to the task, even when the column name stays the same.

For human annotation, preserve the instructions, adjudication policy, and sampling scheme. Reviewers can also see future information; their interface must match the annotation question you intended to ask.

## Make the dataset reconstructible

A useful manifest records source snapshots or immutable object versions, query revision, time boundaries, entity split assignments, transformation code, label policy, row counts, and content checksums where practical. A random seed alone cannot reconstruct data that has since changed.

Run a deliberately hostile review: remove the most predictive suspicious feature, move the cutoff earlier, evaluate on entirely new entities, and compare performance. A large collapse is not automatic proof of leakage, but it identifies an assumption worth investigating before deployment.

The [2015 paper on hidden technical debt in ML systems](https://research.google/pubs/hidden-technical-debt-in-machine-learning-systems/) describes the risks of data dependencies and system interactions. The timestamp and join checks here are proposed controls for one concrete manifestation of that debt. A model should earn its score using information the deployed system can actually obtain.
