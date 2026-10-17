---
title: "Who pays for the egress: establish it behaviourally, not from the console"
category: Storage
tags: ["AWS S3", "Requester Pays", "Cloud Cost", "Egress", "IAM", "Data Transfer", "FinOps"]
summary: >-
  Before pulling tens of terabytes out of someone else's bucket, you want to
  know whose invoice it lands on. The configuration API that would answer the
  question is usually denied to you — but the behaviour of a single GET answers
  it definitively.
description: "How to determine whether an S3 bucket is Requester Pays when the configuration API is denied: a behavioural test, what canonical-ID ACL grants imply, and how to record cost attribution."
date: "2026-10-03"
archive_date: true
published_on: "2026-10-17"
last_reviewed: "2026-10-17"
series: "HPC and AI infrastructure engineering"
---

A collaborator grants you access to a bucket and asks you to take a copy. The dataset is tens
of terabytes. Somebody is going to be billed for that transfer, and the person who should find
out which somebody is you, before the transfer rather than after it.

The question has a precise technical answer, and the obvious way to look it up does not work.

## The configuration call you cannot make

Requester Pays is a bucket-level setting, and there is an API for reading it:

```bash
aws s3api get-bucket-request-payment --bucket "$B"
```

```
An error occurred (AccessDenied) when calling the GetBucketRequestPayment operation
```

This is the normal outcome when your access was granted at the object level. Reading bucket
configuration requires permissions on the bucket resource that a data-sharing grant does not
include, and there is no reason for the owner to have given them to you. So the authoritative
source is closed.

`AccessDenied` here tells you nothing about the setting. It is not evidence either way.

## The behaviour is the test

The specification gives you a clean experiment. When a bucket has Requester Pays enabled, S3
**rejects** any request that does not carry the `x-amz-request-payer: requester` header, with
403. That rejection is not optional and not configurable — its entire purpose is to stop a
requester being billed without having acknowledged it.

Therefore:

```bash
# deliberately WITHOUT --request-payer
aws s3api head-object --bucket "$B" --key "$SMALL_KEY" >/dev/null 2>&1 && echo "NOT requester-pays"
```

A request that succeeds **without** the header proves the bucket is not Requester Pays, because
if it were, that request would have been refused. One small object, one call, a definitive
answer about a multi-terabyte transfer.

Run it the other way for completeness and the result is uninformative: adding
`--request-payer requester` to a bucket that does not require it is simply accepted, so success
with the header tells you nothing. The informative case is the bare request.

Use `head-object`, not `get-object`, and use the smallest object you can find. You want the
cheapest possible probe, and you do not want the probe itself to be a meaningful transfer.

## What the grant type already tells you

If access arrived as a **canonical user ID grant in the bucket ACL** rather than as a bucket
policy, you can predict the shape of what will work before you try it, and it is a shape that
confuses people:

- `s3 ls s3://bucket/prefix/` fails with AccessDenied — listing is a bucket-level operation.
- `s3 cp s3://bucket/prefix/object .` succeeds — reading is an object-level operation.

Which means the data is fully readable and completely unbrowsable. You cannot discover keys;
you can only fetch keys you were told about. The practical consequence is that the transfer has
to be **manifest-driven**: ask the owner for the key list, or get it from the accompanying
metadata, and drive the download from that file. A recursive sync will fail at the first
listing call and the error will look like a credentials problem.

This is also the reason to check the grant type early. "Can I list it?" and "can I read it?"
have different answers here, and a plan built on the assumption that listing works needs
rewriting rather than retrying.

## Egress is charged to the bucket owner by default

The default, with Requester Pays off, is that the **bucket owner** pays for data transfer out.
That is the usual arrangement for a data-distribution bucket run by a repository or a
collaborating lab: they have budgeted for distribution, and they would rather not add a billing
negotiation to every data request.

So for a standard download from a public-facing research bucket, with Requester Pays
established as off by the behavioural test above, the cost attribution is:

- egress: paid by the data owner
- your own account: effectively nothing for the transfer itself
- your real costs: the storage you land it on, and anything you then run over it

That last line is the one worth putting in front of whoever asked for the data, because it is
the cost that does not go away. Egress is a one-off on someone else's invoice; the capacity is
yours for as long as the project lasts.

## Record it where it will be read again

A verbal "they pay for it" does not survive the project. The thing that works is a small
structured record per dataset, checked into the repository and rendered anywhere the transfer's
status is displayed — so the cost question is answered in the same place as the progress
question and cannot drift away from it.

```json
{
  "dataset": "example-cohort-r5",
  "bucket": "s3://example-distribution/prefix/",
  "access_model": "canonical-user-ID bucket ACL grant",
  "reading_as": "arn:aws:iam::<account>:user/<downloader>",
  "requester_pays": false,
  "requester_pays_method": "behavioural: HEAD without x-amz-request-payer succeeded",
  "verified_on": "2026-10-03",
  "egress_paid_by": "data owner",
  "our_transfer_cost": "none",
  "our_ongoing_cost": "destination capacity + compute",
  "if_this_changes": "owner enabling Requester Pays mid-transfer returns 403 AccessDenied"
}
```

The `if_this_changes` field earns its place. If the owner enables Requester Pays while a long
transfer is running, your requests start returning 403 — they do not start silently billing
you, which is the good news. The bad news is how that 403 gets classified. A bare `AccessDenied`
often does not match a downloader's credential-expiry pattern, so it gets counted as a generic
failure and retried. Visible in the failure column, yes; but it will not raise the
"re-authenticate" alert, and an operator reading a dashboard sees retries rather than a policy
change. Worth knowing which bucket your alerting puts it in.

## A short checklist before a large pull

1. Probe Requester Pays behaviourally with one `head-object` and no payer header.
2. Establish whether listing works; if not, obtain a manifest and drive from it.
3. Confirm the identity you are actually reading as — `aws sts get-caller-identity` — and that
   it is the identity the grant was issued to.
4. Size the destination, including the headroom for whatever the first analysis step writes.
5. Write down who pays, how you established it, and what a mid-transfer change would look like.
6. Decide the verification method now, while you can still ask the owner for checksums.

## Symptom against cause

| Symptom | Cause | Action |
|---|---|---|
| `get-bucket-request-payment` denied | Object-level grant, no bucket-config permission | test behaviourally instead |
| `s3 ls` denied but `s3 cp` works | Canonical-ID ACL grant | manifest-driven download |
| 403 on every object mid-transfer | Payer requirement turned on, or grant withdrawn | add `--request-payer`, confirm with the owner |
| Transfer succeeds, surprise invoice | Requester Pays was on and the tool set the header for you | probe before, not after |
| Recursive sync fails immediately | First call is a LIST | drive from a key list |

The principle generalises past S3: **when the configuration API is closed to you, the
specification's mandatory behaviour is still an oracle.** A setting you are not allowed to read
can often be established by the response to a request you are allowed to make — and that is a
stronger result than reading the config, because it tests the path your transfer will actually
take.
