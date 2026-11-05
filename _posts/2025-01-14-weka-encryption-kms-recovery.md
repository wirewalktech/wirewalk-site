---
title: "WEKA encryption: include the key service in the recovery plan"
category: "Storage security"
tags: ["WEKA", "KMS", "Vault", "Encryption"]
summary: "Encrypted data and recoverable data are different outcomes. Test the key dependency without risking production keys."
date: "2025-01-14"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
seo_title: "WEKA Encryption: KMS Dependencies and Recovery Testing"
description: "Include KMS availability, credentials and startup order in WEKA recovery planning. Test key-service failure without risking production keys."
---

A storage cluster can be healthy and its data inaccessible because the recovery environment cannot reach the key-management service. Include KMS authentication, certificates and key availability in the recovery plan, alongside the storage and network dependencies.

## Establish the release and encryption state

The WEKA 4.2 documentation describes an external KMS for encrypted filesystems and documents the read-only `weka security kms` command. It identifies Vault and KMIP integrations; support details must be checked against the deployed release. See [security management](https://docs.weka.io/4.2/usage/security) and [the API/CLI reference](https://docs.weka.io/4.2/getting-started-with-weka/weka-rest-api-and-equivalent-cli-commands).

On an authorized management host with the matching WEKA CLI, inspect:

```bash
weka version
weka fs
weka security kms
```

These are inventory commands, not a recovery test. Treat their output as sensitive configuration information and store it accordingly.

## Draw the boot and recovery order

Record how the KMS itself starts after a site outage. Identify its storage, DNS, certificates, authentication backend, and recovery custodians. If those services depend entirely on the encrypted filesystem, there is a circular dependency to resolve.

A recovery worksheet should include the filesystem, KMS endpoint, key identifier, trusted CA, authentication method, supported recovery procedure, and owner. It should not contain private keys, tokens, or unseal material.

Decide which copies of configuration can be held in an emergency package and which secrets require separate custodians. An offline document that says “log into the vault” is incomplete if the vault is what failed.

## Use a lab to test key-service loss

Create a disposable encrypted filesystem with a test key and representative data. Establish a baseline read and recovery operation. Under the vendor's supported test procedure, simulate KMS unavailability in the lab and observe existing access, new mounts, and recovery behavior separately.

Do not infer one behavior from another. Cached key material and lifecycle operations can create different dependencies. Do not delete or disable production keys to see what happens.

Restore the lab KMS path and repeat the original operation. Record any manual steps, certificate failures, authentication changes, and elapsed time. The result should identify which operations require the KMS, not simply whether the cluster stayed up.

## Separate key rotation from data movement

Key rewrapping, key replacement, and bulk data re-encryption are not interchangeable terms. Use the release-specific workflow and inspect the resulting configuration. A successful rotation task should be followed by access and recovery tests using the intended recovery environment.

Test that authorized workloads can use the protected data from the recovery environment, while unauthorized identities remain excluded. Repeat with the normal site unavailable. See [Snap-To-Object recovery](/writing/weka-snap-to-object-recovery/) for the associated data-side exercise.
