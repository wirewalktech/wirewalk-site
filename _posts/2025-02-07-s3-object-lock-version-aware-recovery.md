---
title: "S3 Object Lock: test versions, not just object names"
category: "Storage security"
tags: ["Amazon S3", "Object Lock", "Retention"]
summary: "A delete marker can hide a protected version. Recovery tooling must know which version it needs."
date: "2025-02-07"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

An object disappearing from a normal listing does not prove its protected contents were destroyed. Conversely, enabling a bucket feature does not prove that every object version has the intended retention. S3 recovery tests need version-aware evidence.

## Understand the unit of protection

Amazon S3 Object Lock applies to object versions. AWS documents governance and compliance retention modes, along with legal holds. A new version or a delete marker can exist above a protected version. Governance bypass requires specific authority and a bypass request; compliance retention has a different boundary. See [AWS Object Lock documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html).

These are Amazon S3 semantics. An S3-compatible product needs its own compatibility review. Do not assume identical retention behavior because both systems accept an S3 client.

## Inspect a known test object

With AWS CLI installed and a read-only role authorized for a dedicated lab bucket, replace the example names and version identifier:

```bash
aws s3api get-object-lock-configuration --bucket example-recovery-lab
aws s3api list-object-versions --bucket example-recovery-lab --prefix test.txt
aws s3api get-object-retention --bucket example-recovery-lab \
  --key test.txt --version-id EXAMPLE_VERSION_ID
aws s3api get-object-legal-hold --bucket example-recovery-lab \
  --key test.txt --version-id EXAMPLE_VERSION_ID
```

Capture the exact version ID. An access-denied response means the inspection is incomplete; it does not mean retention is absent. Likewise, a bucket default is not a substitute for examining the version you intend to recover.

## Design positive and negative tests

Upload synthetic data under an approved short test retention. Confirm that the protected version cannot be permanently removed by the ordinary application role. Test any governance-bypass role separately, with a disposable object and an explicit expected result.

Then verify that the recovery role can retrieve the intended historical version even when it is no longer the current one. Compare its content against a local test checksum. Do not perform these deletion exercises against actual backup objects.

## Preserve the other dependencies

Object retention does not preserve an application's encryption keys, restore catalogue, account access, or business knowledge about which point is clean. Keep those in the recovery design. A backup system should also document its required permissions and supported bucket configuration before retention is enforced.

Monitor failed writes, cleanup failures, and capacity growth after rollout. Protection that interferes with a backup product's lifecycle can create a different outage while appearing to improve security.

## Evidence that answers the question

The useful report contains the bucket configuration, version identifier, retention state, tested identities, denied destructive operation, and successful version-specific retrieval. “Object Lock enabled” is only one line in that report.

Compare this model with [PowerScale SmartLock](/writing/powerscale-smartlock-replication-retention/); the two are related design problems, not interchangeable implementations.
