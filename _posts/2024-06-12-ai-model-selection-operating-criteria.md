---
title: "Choosing an AI model: requirements, evidence, and the cost of being wrong"
date: "2024-06-12 10:00:00-04:00"
category: "AI Engineering"
tags: ["Model Selection", "Evaluation", "Architecture"]
summary: "A practical model selection process covering task fit, baselines, data boundaries, failure costs, evaluation design, latency, and the operating burden behind a benchmark score."
description: "A practical model selection process covering task fit, baselines, data boundaries, failure costs, evaluation design, latency, and the operating burden behind a benchmark score."
---

A model comparison starts badly when the first artifact is a leaderboard. A leaderboard can help produce a shortlist, but it cannot tell you which errors your organization can tolerate, whether the inputs are lawful to use, or how a service behaves during its busiest hour. Those are selection criteria, and they need to exist before someone starts tuning prompts or buying accelerators.

The useful output of model selection is a decision record: what the system must do, which candidates were tested, what eliminated each alternative, and what evidence would cause the decision to change. The following process is an engineering recommendation for producing that record.

## Write the task as an input and an accepted output

“Use AI for support” is too broad to evaluate. “Assign each incoming ticket to one of twelve queues, with uncertain cases sent to an operator” is a testable task. Record the input fields available at decision time, the output schema, the consumer of the output, and the action that follows it.

Separate tasks that have different failure consequences. Drafting a proposed response and automatically changing an account are separate capabilities even if the same language model could produce both outputs. An extraction system may need exact field values and evidence spans; a search system may need useful ranking; a forecasting system needs errors measured at a specified horizon.

Describe what the system should do when information is missing. An abstention is an output with an operating cost, not an embarrassing case to delete from the evaluation. A candidate that can identify uncertainty usefully may be preferable to one with slightly better average accuracy and uncontrolled confident errors.

## Establish a simple baseline

Before comparing large models, build the least complicated credible solution. For structured classification this might be logistic regression or a boosted tree. For document routing it might be keywords plus an existing search index. For a bounded extraction task it might be a parser and a review queue.

These are engineering controls on the experiment. If a more expensive candidate cannot beat the baseline under the real acceptance rules, additional model capacity has not justified its operating cost. The [2016 XGBoost paper](https://arxiv.org/abs/1603.02754) is useful historical context: scalable tree learning was already a serious option for structured data well before the current interest in generative systems. It does not establish that boosted trees win every tabular task.

Compare against the current human or software process as well. Measure its error rate, turnaround time, and workload. Otherwise the project may optimize a model metric while making the actual service slower.

## Apply hard gates before scoring preferences

A weighted score can hide a disqualifying property. Treat mandatory requirements as pass/fail gates and document who can approve an exception.

| Criterion | Evidence to request | Selection consequence |
|---|---|---|
| Data handling | Actual hosting path, retention settings, operator access | Exclude incompatible processing arrangements |
| Usage rights | License for the exact weights and intended use | Exclude unresolved restrictions |
| Output behavior | Representative schema and failure tests | Require validation or reject the candidate |
| Capacity | Measured latency at expected concurrency | Size the service or remove it from the shortlist |
| Recovery | Available version, deployment artifact, rollback procedure | Reject an unmaintainable dependency |

A downloadable checkpoint is not automatically unrestricted software. Model weights, tokenizer files, training data, and serving components can carry different terms. Record the actual artifacts reviewed rather than relying on the label “open.”

## Build an evaluation set that resembles deployment

Sample work by source, length, language, complexity, and business importance. Include normal inputs, incomplete inputs, and inputs the system should decline. Keep entire related entities together when splitting data so that near duplicates or repeated customers do not create misleading independence.

Separate development cases from a final held-out evaluation. Prompts, thresholds, preprocessing, and model choice are all fitted decisions when they are adjusted in response to examples. Repeatedly looking at a held-out score turns it into another development signal. Preserve an untouched set for the final comparison, then collect new evidence after deployment.

For classification, publish a confusion matrix and the performance of important slices. For generation, define a rubric with concrete examples of acceptable and unacceptable answers. Blind the reviewers to candidate identity where practical. Record disagreements and resolve rubric ambiguities before treating small score differences as meaningful.

## Price the error and the review work

Suppose, purely as an illustration, 10,000 documents arrive daily. Candidate A saves two seconds per document but creates 100 additional manual exceptions. If an exception takes five minutes, the added review is 500 minutes per day; the time saved is about 333 minutes. The faster model has increased the total labor requirement.

Use a cost model that includes serving, review, reprocessing, storage, operational support, and the impact of mistakes. A threshold should reflect those consequences. Do not assign a dollar figure to an uncertain harm just to make a spreadsheet appear precise; identify the uncertainty and test the operational response instead.

Where errors affect people or expensive actions, inspect which populations or work categories experience the errors. A good aggregate can coexist with an unusable result on the slice that matters most.

## Measure performance under the intended workload

Use the expected distribution of request sizes and simultaneous users. Report median and tail latency, rejected requests, timeouts, and throughput within the latency objective. For generated output, distinguish time to first output from time to completion. A short demonstration answer does not represent a long document workload.

Include validation and downstream work in the measurement. If an answer requires a repair call or operator correction, count that. If a model needs more retrieval context to meet quality requirements, include that context in its memory and latency profile.

Choose a capacity margin intentionally. The smallest deployment that survives an average load test may have no room for retries, a failed replica, or a sudden burst.

## Select a model you can operate

For the finalists, rehearse a version change, a failed dependency, and a rollback. Identify who owns evaluation cases, who can change the model, and who responds when the service produces valid-looking but incorrect output.

Record the exact model revision, preprocessing, prompt or feature pipeline, runtime, and acceptance thresholds. Schedule a review trigger such as a changed task, changed input distribution, revoked artifact availability, or measured quality regression. The [2017 ML Test Score](https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/) provides a production-readiness rubric; the decision gates here are a proposed way to apply that concern to selection.

The final record should allow another engineer to explain why the chosen system was acceptable, reproduce the comparison, and recognize when the assumptions no longer hold. That is a more durable result than declaring a universal best model.
