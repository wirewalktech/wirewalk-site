---
title: "IOR and mdtest: why your storage benchmark says the filesystem is fine"
date: 2026-09-03
category: Storage
tags: [IOR, mdtest, GPFS, Lustre]
summary: >-
  Streaming bandwidth is the easiest number to produce and the least likely to
  describe an AI training workload. The metadata rate usually matters more, and
  almost nobody measures it.
---

Two tools cover most of what you need from a parallel filesystem. IOR measures
bandwidth by moving large blocks. mdtest measures metadata by creating, stating
and removing enormous numbers of files. Both come from the same repository and
build together.

The common failure is running only IOR, getting a large number, and concluding
the storage is healthy. For a training workload reading millions of small files,
that number describes almost nothing you care about.

## Defeating the cache, which is most of the work

The single most important thing about IOR is that a naive invocation measures
page cache. The client caches the write, reports success, and IOR reports a
bandwidth figure that reflects memory speed rather than storage.

Three flags matter:

```bash
mpirun -np 128 ./ior \
  -a POSIX -w -r \
  -b 16g -t 4m -s 1 \
  -F -e -C -i 3 \
  -o /gpfs/scratch/iortest/file
```

- `-e` calls `fsync` before the write phase timer stops, so the write is on
  stable storage rather than in the client's cache.
- `-C` reorders tasks between the write and read phases, so no rank reads back
  the file it just wrote and finds it sitting in local page cache.
- `-b` sets the block size per task. Make the aggregate substantially larger than
  the total client memory, or the read phase is served from RAM.

Without those, your read bandwidth will look wonderful and mean nothing. If a
result looks impossibly good, this is the reason, every time.

`-F` selects file-per-process. The alternative, a single shared file, tests a
different thing: lock contention and the filesystem's ability to handle
concurrent writers to one inode. Both are worth measuring, because applications
do both, and on some filesystems they perform very differently.

`-t` is the transfer size, the size of each individual read or write call.
Sweeping it is how you find where the client stops being able to fill the pipe.

## The metadata problem

Now the part that usually explains the complaint you were called about.

```bash
mpirun -np 128 ./mdtest \
  -n 10000 -u -z 2 -b 8 \
  -i 3 -d /gpfs/scratch/mdtest
```

mdtest reports operations per second for file creation, stat, read, and removal,
plus the directory equivalents. `-u` gives each task its own working directory,
`-z` and `-b` control the depth and branching of the directory tree, and `-n` is
files per task.

Run it with `-u` and without. The difference is often dramatic, and it is one of
the more actionable results you can produce, because it tells you directly
whether the application's directory layout is the problem. A single directory
holding a very large number of entries serializes on the metadata path in a way
that the same files spread across a tree do not.

<div class="note" markdown="1">
For AI training, metadata rate and small-file read latency usually predict
throughput far better than streaming bandwidth. A dataset of millions of small
files spends its time in `open` and `stat`, not in moving bytes. If you measure
one thing, measure that.
</div>

## Interpreting the gap between the two

The relationship between the IOR and mdtest results is more informative than
either alone.

- **High bandwidth, high metadata rate.** The filesystem is healthy. If an
  application is still slow, the problem is in the application's access pattern
  or in the client, not the storage.
- **High bandwidth, poor metadata rate.** Classic parallel filesystem shape.
  The data path is fine and the metadata path is the bottleneck. Look at
  metadata server placement, whether metadata sits on the same media as data,
  and how the workload lays out directories.
- **Poor bandwidth, high metadata rate.** Usually the network or client
  configuration rather than the filesystem: check RDMA is engaged, check the
  mount options, check that clients are not falling back to a slower transport.
- **Both poor.** Look at the client before the server. A single-client run that
  is also slow points at the node; a slow aggregate with fast single-client
  results points at the server or the fabric between.

## Running it so the numbers survive scrutiny

Use `-i` to repeat and report the spread, not a single lucky run. Record the
client count, the ranks per client, the transfer and block sizes, the filesystem
version and the mount options alongside the result. Run against a directory with
the same striping or placement policy the real workload will use, because a
default-policy test directory can behave nothing like a production dataset.

And run the same configuration on a schedule. A storage benchmark taken once
during acceptance is an anecdote. The same benchmark taken monthly is a baseline,
and a baseline is the only thing that turns "it feels slower lately" into a
number you can act on.
