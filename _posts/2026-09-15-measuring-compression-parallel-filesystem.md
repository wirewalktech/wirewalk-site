---
title: "Why du and df disagree about a compressed filesystem"
category: Storage
tags: ["GPFS", "Spectrum Scale", "Compression", "Quotas", "Capacity Planning", "Parallel Filesystem"]
summary: >-
  du reports a file's apparent size, so on a transparently compressed filesystem
  it measures the data you wrote, not the space you occupy. Getting the real
  ratio means asking the allocator, and asking it about the right set of files.
description: "How to measure compression ratio on GPFS and other parallel filesystems: why du cannot see it, which tools report allocated blocks, and the scoping error that inflates the ratio."
date: "2026-09-15"
archive_date: true
published_on: "2026-10-17"
last_reviewed: "2026-10-17"
series: "HPC and AI infrastructure engineering"
---

Someone enables transparent compression on a dataset, waits for the policy run to finish, and
then wants to know what it bought. The obvious command is wrong, and the wrong answer it gives
is a plausible one — which is the only kind of wrong answer that causes trouble.

## du measures the wrong thing, by design

`du` without arguments reports blocks the file claims to occupy, derived from the file's
apparent size. That is a property of the inode, not of the storage. On a filesystem where
compression happens below the file abstraction, the apparent size does not change when the
data is compressed: the file is still logically the same number of bytes, and a read still
returns them all.

So `du -sh` on a compressed directory returns roughly what it returned before compression ran.
Not exactly — metadata and sparse regions move it a little — which is worse than returning an
obviously identical number, because a small difference reads as a small compression ratio
rather than as a measurement that is not looking at the right layer.

`du --apparent-size` is explicit about measuring the logical size. `du` without it is
*implicitly* measuring something close to it on this class of filesystem. Neither tells you
about allocation.

## Ask the component that allocates blocks

The number you want is allocated blocks versus logical bytes, and only the filesystem's own
accounting knows both. On GPFS, quota reporting is the cheapest source, because it is
maintained continuously rather than computed by walking the tree:

```bash
mmrepquota -j --block-size 1K gpfs0
```

The block column is allocation. Compare it against the logical total for the same fileset to
get a ratio. For per-file detail:

```bash
mmlsattr -L /path/to/file          # shows whether the file is compressed, and the algorithm
```

For a whole tree, a policy scan reports both numbers per file, which is the authoritative
version and the expensive one:

```
RULE 'sizes' LIST 'sizes' SHOW(varchar(FILE_SIZE) || ' ' || varchar(KB_ALLOCATED))
```

```bash
mmapplypolicy /gpfs/gpfs0/dataset -P sizes.pol -I defer -f /gpfs/gpfs0/tmp/out -L 1 \
  -g /gpfs/gpfs0/tmp/shared
```

Two operational notes on that command, both of which cost time if you meet them cold. The
`-g` directory must be on **shared** storage that every participating node can write to, or
the run fails in a way that reads like a permissions problem on the data. And
`mmapplypolicy` can exit zero having done nothing useful, so check the record count in the
output file rather than the exit status.

The LIST output format is worth reading once before parsing it. Each line is

```
<inode> <gen> <snapid>  <FILE_SIZE> <KB_ALLOCATED> -- <path>
```

with a **single** ` -- ` separating the fixed fields from the path. Parsers written on the
assumption of two separators aggregate nothing at all, from a scan that read every file
correctly — and they do it silently, producing a tidy zero.

## The scoping error that inflates the ratio

Here is the mistake that produced a ratio nearly 60% too good in a real measurement, and it has
nothing to do with compression.

If you are comparing a source dataset against a compressed copy — a replica, a backup target, a
migrated tree — the logical total must be computed over **exactly the files that exist on the
target**. It is very easy to sum the logical size of everything the policy was supposed to
cover, divide by the allocation actually present, and report the result as a compression ratio.
What you have actually measured is compression *plus* every file that has not been copied yet.

```bash
# the set actually present on the target, not the set we intended to send
present=$(ssh target "find /backup/dataset -mindepth 1 -maxdepth 1 -printf '%f\n'" | sort -u)

logical=0
while read -r fs; do
  if grep -qx "$fs" <<<"$present"; then
    logical=$(( logical + ${SRC_KB[$fs]:-0} ))
  else
    pending=$(( pending + 1 ))     # count it, do not let it into the ratio
  fi
done <<<"$covered"
```

Reporting "ratio 1.26x, 7 filesets pending seed" is useful. Reporting "ratio 1.93x" because
seven filesets had not arrived yet is the kind of number that ends up in a capacity plan.

The cross-check costs nothing: take one fileset, get its ratio from quota accounting alone, and
see whether it agrees with the aggregate. If the aggregate is much better than every individual
member, the aggregate is wrong.

## What ratio to expect, and why the average is not useful

Compression ratio is a property of the data, not of the filesystem, so a single site-wide number
mostly tells you what kind of data you have:

- Already-compressed formats — most genomics alignment and variant formats, JPEG, MP4, anything
  gzipped — give you essentially nothing. A ratio of 1.0x here is correct behaviour, not a
  misconfiguration, and burning CPU to re-compress them is a loss.
- Text, logs, uncompressed tabular data, sparse scientific arrays — this is where lz4-class
  algorithms earn their keep.
- Many small files are dominated by metadata and block rounding, where the ratio can be worse
  than 1.0 once you account for the inode and the minimum allocation.

Which means the honest reporting unit is per-dataset, not per-filesystem. A single aggregate
ratio over a mixed estate is an average of things with different causes.

## Capacity planning on a ratio you cannot control

The planning trap: compression ratio is an **observed** property of today's data, and the
headroom it creates is spent by tomorrow's data, which may compress differently. A dataset that
is 1.3x today because it is mostly text can drift to 1.0x as it fills with compressed archives,
and the filesystem fills faster than the plan said while nothing has gone wrong.

Three habits that make this survivable:

- Report **both** logical and allocated in the dashboard, never the ratio alone. The ratio hides
  a growing denominator.
- Track free space against allocation. That is the number that causes an outage.
- Keep an explicit list of datasets excluded from compression by design, so that "not
  compressed" is visibly a decision rather than an oversight. On the panel that shows
  unprotected or uncompressed data, an item that is there on purpose and unlabelled will make
  the whole panel get ignored.

## Symptom against cause

| Symptom | Cause | What to use instead |
|---|---|---|
| Ratio reads ~1.0x after a successful policy run | `du` reporting apparent size | quota accounting, or `KB_ALLOCATED` from a scan |
| Ratio far better than any single dataset | Logical total includes files not present on target | restrict the numerator to files that exist there |
| Scan "succeeded" but aggregated nothing | LIST line has one ` -- `, parser expected two | print one raw line and read it |
| Policy run exits 0, no output | `-g` not on shared storage, or `-L` too low | check record count, not exit status |
| Space shrinks less than the ratio predicts | Data was already compressed | measure per dataset, not per filesystem |

The underlying point is the one that applies whenever a layer below you is doing work on your
behalf: **a tool that reports a file's size is not reporting your storage consumption.** If you
want to know what you are paying for, ask the thing that does the allocating.
