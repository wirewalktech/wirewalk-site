---
title: 'Slurm controller failover: protect the state before trusting the backup'
date: 2026-07-07 10:00:00 -0400
category: HPC Operations
tags:
- Slurm
- Scheduling
- Linux
- Recovery
summary: Qualify Slurm controller high availability through shared-state checks, dependency failure tests, accounting
  separation and evidence from real job transitions.
seo_title: Slurm Controller HA Setup and Failover Troubleshooting
description: Set up and troubleshoot Slurm controller high availability with shared state, dependency checks, controlled
  failover tests and useful monitoring.
---

Two healthy controller processes are only the beginning of a Slurm high-availability design. The backup still needs the correct configuration, credentials and state storage when it becomes active. A failure in that shared dependency can defeat both machines at once.

Test the transition the researchers depend on: jobs remain identifiable, new submissions receive a clear response, scheduling resumes, and accounting catches up. Process liveness and a successful service restart cover only part of that contract.

The configuration baseline here is **Slurm 25.05**, using its tagged administrator guide and configuration reference. Apply the supported upgrade and recovery procedures for the exact installed release. These examples describe an isolated qualification environment, not commands to fail over an unknown production cluster.

## Map the failure domains and the state they protect

Separate the active controller, backup controller, shared state filesystem, authentication service, name resolution and accounting stack. Record which of those depend on the same power, network or storage infrastructure.

Place controllers on distinct hosts and account for their supporting failure domains. Two virtual machines on one hypervisor can protect against a process failure while sharing the same host outage. The same distinction applies to two hosts using a single storage gateway.

Write down the expected recovery interval and the state-loss assumptions. The [Slurm 25.05 administrator guide](https://raw.githubusercontent.com/SchedMD/slurm/slurm-25-05-0-1/doc/html/quickstart_admin.shtml) notes that recent state can be lost when a controller fails before it is durably written. A backup controller does not turn every acknowledged operation into a zero-loss transaction.

Include user-facing checks in the acceptance criteria. An administrator reaching a controller over SSH is less useful evidence than a research user being able to query and submit through the normal Slurm client configuration.

## Configure one cluster identity and an ordered controller list

An abbreviated configuration illustrates the relevant relationship:

```ini
ClusterName=research-example
SlurmctldHost=controller-a
SlurmctldHost=controller-b
SlurmUser=slurm
StateSaveLocation=/srv/slurm/state
```

Replace these names with qualified controller identities. This is a fragment: node, partition, authentication, accounting and other site settings remain necessary.

In this baseline, the first `SlurmctldHost` is preferred and later entries are backups. Both controllers need the same cluster configuration and compatible software. Validate configuration distribution to clients and compute nodes as well; a host-local fix that never reaches the backup is not a completed HA change.

Keep the state path unique to this cluster. Do not let a reused automation template point two independent clusters at the same controller-state directory. Keep service identities, numeric permissions and authentication configuration consistent while preserving each host's own operating-system identity.

## Prove that the shared path is the intended filesystem

The [25.05 configuration reference](https://raw.githubusercontent.com/SchedMD/slurm/slurm-25-05-0-1/doc/man/man5/slurm.conf.5) requires controller access to `StateSaveLocation`. Verify the mounted source, directory ownership and service-account access from both hosts.

Read-only observations include:

```bash
findmnt -T /srv/slurm/state
namei -l /srv/slurm/state
scontrol ping
scontrol show config
```

A directory existing at that pathname is weak evidence. If the remote mount is absent, an ordinary local directory can remain underneath it. Qualify service startup dependencies so the controller cannot silently initialize against the wrong backing store.

During an approved test, verify actual writes and cross-host reads in a reserved test area on that filesystem, using the service identity. An access-permission check alone does not demonstrate successful durable I/O. Do not place improvised test files among active Slurm state files or copy state while competing controllers are writing it.

Record storage interruption behavior separately from controller process failure. A hanging or read-only state filesystem needs its own tested response; a host reboot may simply move the same dependency failure to the other controller.

## Exercise failover with jobs whose expected state is known

Prepare a small test set: a running job that records progress, a queued job that cannot yet start, and a short job submitted during the transition. Record job IDs, submit times and the expected application outputs.

Trigger one supported failure in the isolated environment, such as stopping the active controller service under the approved procedure. Observe takeover through the normal client path. Track the interval between last successful operation, detected failure and successful resumed scheduling.

Inspect all three jobs afterward. Confirm the running application's progress, the queued job's identity and constraints, and the submission result during the outage. A client timeout can leave a user uncertain about whether submission succeeded; resolve that against the recorded job identity before teaching users to retry blindly.

Keep authentication and filesystem failures out of the first experiment. Once the ordinary controller transition is understood, introduce dependency failures one at a time. Combining them makes a failure harder to explain and a passing result less informative.

## Test the preferred controller's return

The tagged guide describes the preferred controller returning, the active backup saving state and returning to standby, and the preferred host reading that state. Include this return path in qualification rather than ending the exercise as soon as the backup becomes active.

Watch for repeated transitions or recurring client outages. Check configuration consistency, connectivity, time, authentication and storage latency before shortening timers. More aggressive detection can increase sensitivity to transient delays without fixing their cause.

If the observed network state makes controller ownership uncertain, stop improvising promotions. Preserve logs from both hosts and follow the site's isolation and recovery procedure. Starting another controller against an unverified state path can turn an availability problem into a state-recovery problem.

Re-run the job-state checks after failback. Confirm that a completed test job has the expected final state and output, and that the queued job has not silently disappeared or changed identity.

## Keep accounting availability separate

Controller failover does not establish database availability. Slurm's documentation describes separate backup configuration for `slurmdbd`, with both instances accessing the same database. That arrangement still needs a database availability and recovery design.

Test the accounting path independently: job submission and scheduling, accounting updates reaching `slurmdbd`, records arriving in the database, and the reporting query returning the expected result. Record delays and any buffering or recovery behavior observed in the installed configuration.

Back up the controller state and accounting database through procedures appropriate to each. They serve different recovery purposes. A database restore cannot replace missing controller state, and a copied controller-state directory does not reconstruct a lost accounting history.

For job-level interpretation, use [Slurm accounting and efficiency checks](/writing/slurm-efficiency-accounting-traps/) alongside the HA timeline. A delayed accounting record should not immediately be labeled a lost job.

## Monitor state access and useful control-plane work

| Signal | What it helps distinguish |
|---|---|
| Controller role and transition history | Stable ownership versus repeated takeover |
| Client query and submission latency | Process liveness versus usable scheduling service |
| State filesystem mount, permissions and latency | Controller failure versus a shared dependency problem |
| Queued/running job identity checks | A responding service versus preserved scheduling state |
| Accounting update and reporting delay | Scheduler recovery versus accounting recovery |
| Configuration and binary identities | A transient incident versus drift between controllers |

Use low-rate, bounded checks that do not create a scheduling load of their own. Monitoring should use a service identity with only the necessary access, and test jobs should have explicit cleanup and ownership.

Retain the failure sequence, actual recovery times and job outcomes with the configuration release. Rehearse after changes to Slurm, state storage, authentication or controller placement. The [controller-state discussion for Slinky](/writing/slinky-slurm-operator-kubernetes-setup-debugging/) applies the same acceptance principle to a Kubernetes-hosted deployment: the service is ready when its state and research workload survive the agreed transition.
