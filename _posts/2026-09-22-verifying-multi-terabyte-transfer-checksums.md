---
title: "Verifying a multi-terabyte transfer: which checksum, and at what rate"
category: Storage
tags: ["S3", "Object Storage", "Checksums", "CRC64NVME", "Data Integrity", "ETag", "Data Transfer"]
summary: >-
  A transfer that reports success has told you about HTTP status codes, not
  about bytes. Verifying tens of terabytes is tractable, but only if you pick a
  checksum the provider will actually give you for whole objects.
description: "How to verify a large S3 download end to end: why multipart ETags cannot be compared, which checksum algorithms cover whole objects, and how to saturate a parallel filesystem while hashing."
date: "2026-09-22"
archive_date: true
published_on: "2026-10-17"
last_reviewed: "2026-10-17"
series: "HPC and AI infrastructure engineering"
---

A bulk download finishes. The log says every object returned 200 and the byte counts match the
listing. That is a statement about transport, and it is worth less than it looks: it confirms
the number of bytes that arrived, not which bytes. Truncation shows up in a size check.
Corruption in the middle of a 200 GB object does not.

If the data is going to be the input to months of analysis, the verification pass is cheap
insurance. The question is what to compare against.

## The ETag will usually not help you

For an object uploaded in one piece, the S3 `ETag` is the MD5 of the content, and you can
compare it directly. For anything uploaded as a multipart — which is everything large, because
that is how large objects get uploaded — the ETag is a digest *of the part digests*, with the
part count appended:

```
"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6-7210"
```

That `-7210` is the tell: 7,210 parts. To reproduce the value you need the exact part size the
uploader used, and the part boundaries, and then you have to hash each part and hash the
concatenation of those hashes. If the uploader used a non-uniform part size, you cannot
reproduce it at all. Treat a hyphen in an ETag as "this field is not a content hash".

## Ask for a checksum that covers the whole object

Modern S3 supports additional checksum algorithms that are stored as object metadata, and the
one that matters here is whether the stored value covers the **whole object** or only parts.

```bash
aws s3api head-object --bucket "$B" --key "$K" \
  --checksum-mode ENABLED \
  --query '{Algo:ChecksumType,CRC64:ChecksumCRC64NVME,SHA256:ChecksumSHA256,ETag:ETag}'
```

```json
{ "Algo": "FULL_OBJECT", "CRC64": "k3Nf0pQ2vLs=", "SHA256": null,
  "ETag": "\"a1b2...-7210\"" }
```

`ChecksumType: FULL_OBJECT` is the field to look for. With CRC64NVME it is the common case, and
it means the provider is giving you one value you can compute locally over the assembled file —
no part boundaries required. `COMPOSITE` means you are back in part-digest territory and the
value is not directly comparable.

Two practical constraints that are easy to discover the hard way:

- **A ranged GET returns no checksum.** If your verification reads objects in ranges, there is
  nothing to compare. Hash the local file; take the stored value from `head-object`.
- **The algorithm has to have been set at upload time.** You cannot ask a bucket to produce a
  SHA256 for an object that was written without one. Check what is actually there before
  designing the comparison; if the answer is "nothing but a multipart ETag", your verification
  is a size-and-count check plus a re-download of a sample, and you should say so rather than
  implying a cryptographic guarantee.

## CRC64NVME locally, fast enough to not matter

CRC64NVME is cheap — a few GB/s per core with a table-driven implementation, and effectively
free next to the storage. Python with a compiled backend is sufficient:

```python
import sys
from anycrc import Model            # or any CRC-64/NVME implementation
import base64

crc = Model("CRC64-NVME")
with open(sys.argv[1], "rb", buffering=0) as f:
    h = crc.new()
    while chunk := f.read(16 << 20):     # 16 MiB reads suit a parallel filesystem
        h.update(chunk)
print(base64.b64encode(h.digest().to_bytes(8, "big")).decode())
```

Note the base64: S3 returns the checksum base64-encoded, not as hex. Comparing a hex string to
a base64 string produces a mismatch on every object, which looks like catastrophic corruption
for the ten minutes it takes to notice.

## The rate is a parallelism problem, not a hashing problem

Hashing is not the bottleneck; reading is. On a parallel filesystem the useful shape is many
files in flight, large reads, and no single-threaded driver walking the tree.

Two numbers from the same verification run, to show how badly this can be misjudged. An early
estimate taken while the job was running said **660 MB/s, about 26 hours**. It was computed
from the first handful of completed objects — which were the small ones, because small files
finish first. Once the large multi-terabyte objects landed, the real aggregate for the full pass
was **11.4 GiB/s, and it finished in 88 minutes**.

The estimate was not slightly off. It was wrong by a factor of 17, in the pessimistic
direction, because it extrapolated from a sample that was biased by construction. This is the
general hazard in any progress estimate over unevenly sized work: completion order is
correlated with size, so the early sample is never representative.

Practical guidance for the run itself:

- Drive concurrency from a file list, not a directory walk, so the work can be split and
  resumed.
- Pick the unit of parallelism to match the storage. Tens of concurrent readers with large
  sequential reads will saturate most parallel filesystems; hundreds will produce queueing and
  a worse number.
- Write one result line per object — key, expected, computed, verdict — so a partial run is
  still evidence and a re-run only covers what is missing.
- Report **bytes** verified, not objects. One object in a thousand can be most of the data.

## Where the job should run, and as whom

This is the part people reorganise twice. If the destination directory is owned by another user
and mode `0700`, the verification cannot run as a normal user through the scheduler, because the
scheduler runs jobs as the submitting user. Options, in order of preference:

1. Have the data owner run it, which is correct and often not practical on their timetable.
2. Run it as root on a node that has the filesystem mounted and the fast path to it.
3. Grant the verifying identity read access via an ACL — which is fine, but be aware that on
   many filesystems a later `chmod` on those paths will destroy the ACL while `chown` leaves it
   intact.

Option 2 is usually what happens. It is worth writing down which node, and why: the node that
has both the filesystem and the high-bandwidth route is frequently not the node people log in
to, and discovering that mid-run costs a restart.

## Symptom against cause

| Symptom | Cause | Resolution |
|---|---|---|
| Every object mismatches | Comparing hex against base64 | encode locally the way the API returns it |
| ETag will not reproduce | Multipart digest-of-digests | use a `FULL_OBJECT` checksum, or do not claim content verification |
| No checksum in the response | Ranged GET, or none stored at upload | `head-object` for the stored value; check it exists first |
| Throughput an order of magnitude below the filesystem | Serial reads, or one reader per small file | parallel readers, 8–16 MiB reads, list-driven |
| ETA wildly pessimistic early | Small objects complete first | weight progress by bytes, not object count |
| Verification cannot read the data | Destination is `0700` and owned elsewhere | run as owner or root; mind ACL-destroying `chmod` |

The principle: **success reported by the thing doing the copying is not verification.** A
verification pass is a separate pass, over a value the source committed to independently, and
if the source never committed to such a value then the honest description of what you have is
"sizes and counts match" — which is a real statement, just a much weaker one.
