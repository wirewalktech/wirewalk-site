---
title: "Evaluating AI beyond average accuracy: thresholds, calibration, and failure slices"
date: "2024-08-21 10:00:00-04:00"
category: "AI Engineering"
tags: ["Evaluation", "Calibration", "Model Validation"]
summary: "A detailed evaluation plan for classifiers and generated outputs: prevalence, review capacity, calibration, grouped uncertainty, locked test sets, and release criteria that reflect real errors."
description: "A detailed evaluation plan for classifiers and generated outputs: prevalence, review capacity, calibration, grouped uncertainty, locked test sets, and release criteria that reflect real errors."
---

An evaluation report can be numerically correct and operationally useless. “Ninety-nine percent accurate” says little when the event occurs in one record out of a thousand, or when the remaining errors all affect the same input category. A release decision needs evidence about the decisions the system will make, at the thresholds and workload it will actually use.

Start by separating three questions: does the model rank cases usefully, do its scores correspond to observed outcomes, and does the chosen action policy produce acceptable results? These questions require different measurements.

## Specify the decision policy

For a binary classifier, define the positive class and the action triggered by a positive prediction. State what happens below the threshold, what happens in an uncertainty band, and whether an operator can override the system.

For an illustrative alerting service, a high score might create an urgent page, a middle score might create a review task, and a low score might produce no action. Each path has a capacity limit and a different error cost. Evaluate all three paths rather than converting everything to one binary accuracy number.

Include failure to produce a prediction. Invalid input, timeouts, rejected requests, and unavailable features need explicit denominators. Removing these records before scoring can make an unreliable service appear excellent.

## Use prevalence to interpret precision

Imagine 100,000 decision opportunities containing 100 real positives. At 90% sensitivity, the system finds 90 positives. If its false-positive rate is 1%, it also flags 999 of the 99,900 negatives. Precision is then 90 divided by 1,089, approximately 8.3%.

These are illustrative arithmetic values, not measured product results. They show why a seemingly small false-positive rate can overwhelm an operator when the target is rare. If the review team can handle only 200 cases, the policy is infeasible even though its sensitivity might look attractive in isolation.

Keep a confusion matrix with counts, not just percentages. Also report the population and sampling procedure. A balanced development set can be useful for studying errors, but its apparent precision is not the expected precision in a population with a much rarer event.

## Distinguish ranking from calibration

A ranking metric evaluates ordering. A calibrated probability has a different promise: among comparable cases assigned a probability near 0.2, roughly one fifth should be positive over a suitable population and observation period.

A model can rank well and be poorly calibrated. Examine reliability by score bands, sample counts, and important slices. Avoid drawing a calibration curve with tiny bins and treating the shape as stable evidence. If calibration is fitted, use development data that is separate from final testing and check the result again under the deployment distribution.

The [scikit-learn 1.4 probability calibration guide](https://scikit-learn.org/1.4/modules/calibration.html) distinguishes probability reliability from discrimination and describes calibration methods. The engineering policy proposed here is to choose a calibration procedure and threshold on development evidence, then freeze both before the final comparison.

## Evaluate slices that can change the decision

Choose slices before examining candidate results where practical: input source, language, document length, missing-feature pattern, device family, and new versus established entities. Add slices discovered during error analysis, but distinguish exploratory findings from prespecified release criteria.

Record counts and uncertainty for every slice. A 100% score on four examples does not establish reliability. If a slice is important and poorly sampled, collect more examples or constrain deployment until there is enough evidence.

Keep intersections in view. A system may work on long documents and on scanned documents separately while failing on long scanned documents. Avoid generating thousands of tiny slices with no hypothesis; use the failure mechanism to guide investigation.

## Make human judgments reproducible

For generated answers, define a rubric with separate dimensions such as factual correctness, completeness, adherence to the requested format, and unsupported assertions. Specify which errors are release blockers. A fluent response should not earn credit for a fact it invented.

Have reviewers score a shared calibration sample. Discuss disagreements and revise ambiguous instructions before evaluating finalists. Preserve the original judgments as well as adjudicated results, since disagreement is information about the task.

Model-based judges can assist with triage, but their scores need validation against human review on the actual task. Avoid asking a candidate to be its own sole judge. Keep candidate names hidden when feasible and randomize presentation order in pairwise comparisons.

## Preserve the unit of independence

If ten thousand rows come from fifty customers, uncertainty based on ten thousand independent observations may be misleading. Sample or resample at the customer level when that matches the dependency structure. Time-series evaluations need methods that respect temporal dependence rather than arbitrary row shuffling.

Use paired comparisons when candidates are evaluated on the same cases. Inspect where one succeeds and the other fails. A small average advantage may be driven by one prolific source, while a particular critical error worsens.

Report uncertainty in a form the release owner can use. If the interval is too wide to distinguish candidates under the acceptance rule, the conclusion is insufficient evidence, not a forced winner.

## Lock the release test and include the whole service

Before final scoring, freeze model revision, feature or prompt code, preprocessing, decoding settings, threshold, and input contract. Test the validation layer and fallback path as part of the service. A model that usually produces correct JSON is not a reliable structured API unless invalid outputs are detected and handled.

Measure quality under representative concurrency as well as offline conditions. If timeouts disproportionately remove the longest requests, offline quality no longer describes the deployed service. Count retries and human repairs in both cost and success rate.

The [scikit-learn 1.4 model evaluation reference](https://scikit-learn.org/1.4/modules/model_evaluation.html) explains the definitions and limitations of common metrics. Definitions alone do not choose an acceptable threshold; the application owner must connect the metrics to consequences and capacity.

## Write a decision another person can audit

A release report should contain the dataset version, sampling frame, label maturity, policy thresholds, aggregate counts, slice results, latency and failure rates, and a list of unresolved error modes. Include examples that demonstrate the most consequential failures.

Choose monitoring signals that correspond to the evaluation assumptions. If the evaluation depended on a stable document source or a known feature availability rate, monitor those properties. The purpose of evaluation is to establish a bounded claim about a particular service, then recognize when the evidence supporting that claim has expired.
