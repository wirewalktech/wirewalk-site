# Sample HPC and AI remediation plan

## Plan the smallest change that can answer the question

**Illustrative plan — no changes below have been executed.** This example follows the [storage feeding GPUs scenario](https://www.wirewalk.com/investigations/storage-feeding-gpus/). Actual scope, downtime, access and responsibilities are agreed before work begins.

| Phase | Proposed work | Owner | Gate |
|---|---|---|---|
| 0: Preserve | Save baseline, configuration, dataset identity and rollback material | Platform lead | Evidence can be read and tied to the canary |
| 1: Isolate | Measure discovery, reads, transforms, transfer and checkpoint intervals | Performance engineer | Dominant wait has a supported explanation |
| 2: Prepare | Build a versioned candidate input layout without overwriting source data | Data owner | Sample identity and semantics remain valid |
| 3: Canary | Compare candidate and baseline with matched conditions | Joint research/IT team | Correctness and performance criteria reviewed |
| 4: Operate | Assign configuration ownership and test the supported lifecycle | Operations owner | Procedure survives the agreed restart/reimage event |
| 5: Handover | Deliver evidence, instructions, open issues and a readout | Engagement lead | Accountable owner accepts the result |

## Change record

For each action, record affected paths or settings, prerequisites, expected behavior, exact authority, test window, stop conditions and rollback. A configuration owner must be able to recreate the supported state after a replacement or image deployment.

## Rollback

Retain the original dataset and configuration. Stop promotion if correctness changes, shared-storage contention worsens, resource consumption exceeds the agreed envelope or a recovery check fails. Return the canary to the original supported state and repeat the readiness checks. Remove only state owned by this change.

## Completion

The plan is complete when the agreed workload and recovery tests support the decision and the operating team can maintain it. A faster isolated read result is not sufficient if end-to-end training, research semantics or checkpoint recovery remains unresolved.

Retests, further remediation, travel or ongoing operation must be included in the accepted scope or quoted separately. [Procurement and scope guidance](https://www.wirewalk.com/procurement/) explains the starting process.
