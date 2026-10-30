---
title: "RAG, fine-tuning, or pretraining: choosing the intervention that matches the failure"
date: "2025-02-19 10:00:00-05:00"
category: "AI Architecture"
tags: ["RAG", "Fine-Tuning", "Pretraining"]
summary: "How to distinguish missing evidence, task behavior, and base capability when choosing retrieval, supervised adaptation, or pretraining, with separate evaluation plans and realistic infrastructure consequences."
description: "How to distinguish missing evidence, task behavior, and base capability when choosing retrieval, supervised adaptation, or pretraining, with separate evaluation plans and realistic infrastructure consequences."
---

A language-model system gives an incorrect answer. The proposed fixes arrive immediately: add retrieval, fine-tune the model, or train something larger. Each can be appropriate, and each can consume substantial time while leaving the original failure untouched.

Start with error analysis. Determine whether the answer failed because necessary evidence was unavailable, because the system used evidence poorly, because the requested behavior was not learned, or because the underlying model could not perform the task. The intervention should follow that diagnosis.

## Separate knowledge access from learned behavior

Consider an illustrative assistant that answers questions about equipment procedures. A procedure changes frequently, and the model gives an old torque specification. The first question is whether the correct procedure was available to the answer-generation step.

If retrieval returned an obsolete revision, changing the generator weights does not repair document lifecycle management. If retrieval returned the right revision but omitted the relevant table, inspect parsing and chunking. If the necessary table was visible and the answer still ignored it, investigate instruction following, reasoning, and output validation.

A different failure is consistent use of the wrong response format or inability to perform a domain-specific transformation. More documents may not solve that behavior. Supervised examples and a suitable adaptation method may be a better experiment.

## Use retrieval when evidence should remain external

Retrieval-augmented generation supplies relevant material at answer time. The [original RAG paper, submitted in May 2020](https://arxiv.org/abs/2005.11401), combined a parametric generator with a dense index. Enterprise implementations can differ substantially from that research architecture; the common design concern is how external evidence reaches generation.

External evidence is attractive when facts change, when an answer needs traceable sources, or when different users are entitled to different documents. It also creates responsibilities: ingestion, parsing, indexing, revision selection, access enforcement, and deletion propagation.

Enforce authorization before protected text reaches generation, and avoid caches that cross user permission boundaries. A citation is not an access control. An instruction telling a model to ignore unauthorized material is not a substitute for keeping that material out of the request.

## Evaluate retrieval independently

Build a query set with known relevant evidence. Measure whether the retrieval stage finds that evidence and whether the returned version is valid for the question's date and user. Inspect lexical search, vector search, and any reranking separately when they are components of the system.

Test difficult document structures: tables, repeated headers, attachments, scans, superseded procedures, and references spanning sections. Chunk size should follow the information needed to answer, not a universal number of tokens.

Then evaluate generation with the correct evidence supplied directly. If quality remains poor under this controlled condition, search tuning alone will not close the gap. Conversely, if generation succeeds with correct evidence but the end-to-end system fails, focus the next experiment on retrieval and orchestration.

## Fine-tune for a measurable behavior change

Supervised fine-tuning adjusts a pretrained model using task examples. Good candidates include a repeatable extraction format, a specialized transformation, or consistent application of a rubric that the base model does not follow reliably.

Prepare examples with clear target behavior and representative edge cases. Separate training data from evaluation by source or entity where needed. Audit generated training examples instead of assuming synthetic volume produces correct supervision.

Keep a base-model comparison and evaluate general capability as well as task-specific gains. A fine-tuned model can improve one workflow while becoming less reliable on others. If the application needs broad behavior, preserve regression tests for that behavior.

Do not treat a fine-tuned checkpoint as a reliable database of changing facts. Learned associations can be difficult to update or remove precisely, and a model may still invent unsupported details. Retrieval and fine-tuning can be combined when their roles are independently justified.

## Distinguish continued pretraining from supervised adaptation

Continued pretraining uses a general prediction objective on additional domain material. It may help when the underlying language or domain distribution is poorly represented, but it requires a careful corpus policy, compute budget, and evaluation plan. It is not interchangeable with teaching a small set of preferred answer examples.

Training from scratch is a larger decision still. It introduces tokenizer design, corpus acquisition and filtering, long-running distributed optimization, checkpoint recovery, and broad capability evaluation. Possessing a large document collection does not establish that this path is economical or that the rights and quality of the collection are suitable.

The [2017 Transformer paper](https://arxiv.org/abs/1706.03762) establishes the architecture's historical foundation. It does not supply a business case for building a new foundation model. That case needs evidence that adaptation and existing models cannot satisfy the actual requirement.

## Compare complete systems under a fixed task

Use a controlled comparison that includes the same accepted outputs, data boundary, and failure policy. One candidate may combine a smaller model with better retrieval; another may use a larger adapted model. Measure their full behavior, rather than attributing the result solely to parameter count.

| Observed failure | First controlled experiment | Evidence needed before expanding scope |
|---|---|---|
| Correct source never retrieved | Supply the source directly | Generator succeeds with sufficient evidence |
| Wrong document revision | Repair version filtering | Queries select the valid revision consistently |
| Output schema repeatedly wrong | Validate and test supervised adaptation | Reduced repair rate on held-out inputs |
| Domain language poorly understood | Compare domain-adapted candidates | Improvement beyond retrieval and prompting |
| Broad capability absent | Compare stronger base models | A demonstrated task gap with feasible alternatives |

These are diagnostic suggestions, not guarantees about which technique will win.

## Account for operational consequences

Retrieval adds ingestion and query-time dependencies. Fine-tuning adds dataset management, training, and per-version evaluation. Continued pretraining adds much larger compute and corpus obligations. All paths require serving, monitoring, and recovery.

Measure end-to-end latency, indexing freshness, access correctness, answer quality, and operator workload. A cheap generator with a complicated retrieval path may cost more to operate than a simpler alternative. A highly accurate fine-tune may be unsuitable if its training data cannot be maintained.

Choose the smallest intervention that resolves a demonstrated failure and survives the acceptance tests. Keep the diagnostic cases. They are the evidence that lets a future engineer tell whether the next model or data change has repaired the system or merely changed its mistakes.
