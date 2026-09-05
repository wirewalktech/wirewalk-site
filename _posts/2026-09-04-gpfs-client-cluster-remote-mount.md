---
title: "Mounting GPFS from a separate client cluster, end to end"
date: 2026-09-04 10:00:00 -0400
category: Storage
tags: [GPFS, Storage Scale, Remote mount, Client cluster, Multicluster]
summary: >-
  Keeping compute nodes in their own cluster and remote-mounting the filesystem is
  the right default for almost every site. The setup is four commands. The parts
  that bite are the ones that only show up under load, months later.
---

A GPFS filesystem does not have to be mounted by the cluster that owns it. The
owning cluster exports it, a separate client cluster mounts it, and the two are
administered independently. This is the multicluster or remote mount model, and for
most sites with distinct storage and compute hardware it should be the default.

The mechanics are four commands. What follows is the reasoning for the model, the
full sequence, and the failures that appear later — including one that will kill
every running job on a node without logging anything that points at the cause.

## Why separate the clusters at all

**Blast radius.** A client cluster can be restarted, upgraded, reinstalled or
broken without touching the storage cluster. Where compute and storage share a
cluster, every compute-side action is a storage-side risk.

**Version independence.** The two clusters run their own minimum release levels.
You can upgrade compute nodes without moving the storage cluster, which matters
because the storage cluster is the one you least want to touch.

**Quorum separation.** Compute nodes come and go. Storage nodes must not. Sharing a
cluster means the quorum design has to tolerate the churn of the noisiest half.

**Administrative boundary.** The storage team owns the storage cluster's
configuration. A compute-side administrator adding a node cannot alter the storage
cluster's quorum, licensing or tunables by accident.

The cost is one more cluster to manage and an authentication relationship to
maintain. It is worth it.

## Create the client cluster

Install the same GPFS packages, build the portability layer, then create a cluster
containing only the clients:

```bash
mmcrcluster -N clientnodes -r /usr/bin/ssh -R /usr/bin/scp -C compute-cluster
mmchlicense client --accept -N all
```

Note the licence designation. Nodes that only mount a filesystem take a **client**
licence; nodes that serve NSDs take a server licence. Getting this wrong is a
compliance problem rather than a technical one, but it is easier to set correctly
than to correct in an audit.

Give the client cluster its own quorum — three nodes, chosen for stability rather
than convenience. Login nodes and infrastructure nodes make better quorum members
than batch compute nodes that are rebooted between jobs.

## Exchange keys

Each cluster generates a key and receives the other's public half.

On the **storage** cluster:

```bash
mmauth genkey new
mmauth update . -l AUTHONLY
```

On the **client** cluster:

```bash
mmauth genkey new
mmauth update . -l AUTHONLY
```

Then copy each cluster's public key to the other. On the storage cluster, register
the client and grant access to the filesystem:

```bash
mmauth add compute-cluster.example -k /path/to/client_id_rsa.pub
mmauth grant compute-cluster.example -f fs1 -a rw
```

`-a rw` can be `ro` for a read-only export, which is worth using where it fits —
an analysis cluster that only reads a curated dataset does not need write access to
it.

## Define the remote cluster and filesystem on the client

```bash
mmremotecluster add storage-cluster.example \
    -n storage01,storage02,storage03 \
    -k /path/to/storage_id_rsa.pub

mmremotefs add gpfs0 -f fs1 -C storage-cluster.example \
    -T /gpfs/gpfs0 -o rw,atime,mtime -A yes
```

The `-n` list is the contact nodes: the storage-cluster nodes the client will
approach to find the filesystem. Give it several. A single contact node is a single
point of failure for **mounting**, though not for I/O once mounted.

`-A yes` sets automount, so the filesystem mounts at daemon start.

## Understand the local name and the remote name — they are not the same thing

This is the detail that causes the most confusion later, and it is also the feature
that makes filesystem rebuilds survivable.

In `mmremotefs add gpfs0 -f fs1`, `gpfs0` is the **local device name** on the client
cluster and `fs1` is the **remote name** on the storage cluster. They are
independent. `mmremotefs show` displays the mapping:

```
Local Name  Remote Name  Cluster name              Mount Point
gpfs0       fs1          storage-cluster.example   /gpfs/gpfs0
```

The practical consequence: **the storage cluster can rebuild and rename its
filesystem without any client-side path changing.** Build the replacement
filesystem under a new name, migrate, then repoint the remote name. Clients keep
their local device name and their mount point, so module paths, job scripts,
provisioning references and automation all continue to resolve.

The trap that comes with it: anything that consumes the filesystem *name* rather
than the mount point sees the new name. GPFS callbacks receive `%fsName`, and a
callback guard written against the old name silently stops matching. Cron entries
that name the device — snapshot scripts are the usual example — keep pointing at a
device that no longer exists. Before any rename, grep your automation for the
device name; after it, verify the callbacks still fire.

## Configure the client network

Clients need `verbsPorts` set for their own adapters, and it is not inherited from
anywhere useful:

```bash
mmchconfig verbsPorts="mlx5_0/1" -N clientnodes
mmchconfig verbsRdmaSend=yes
```

Then verify RDMA is actually carrying data, rather than assuming:

```bash
mmdiag --network | grep -E "by (TCP|RDMA) connection"
mmfsadm test verbs conn
```

A client silently falling back to TCP over IPoIB will work. It will be several
times slower than it should be, it will not log an error, and the problem will be
attributed to the storage cluster. Check this on new nodes as a matter of routine —
particularly on any node added with `mmaddnode`, which does not inherit per-node
overrides.

## Size the client pagepool deliberately

The default is small — often 1 GiB — and on a compute node with hundreds of
gigabytes of RAM that is usually wrong in one direction or the other.

Too small and you lose read caching and prefetch effectiveness on exactly the
workloads that benefit most. Too large and you have taken memory away from jobs;
on a node where the scheduler enforces memory limits, the pagepool is memory the
scheduler does not know it has already lost.

A few GiB is a reasonable starting point for a general compute node. Match it to
what the node is for, set it per node class rather than globally, and remember it
**only takes effect on daemon restart** — a configured value with no restart is a
value that is not running.

## Bind mounts over GPFS: the hazard that kills jobs silently

Sites commonly bind-mount a directory inside GPFS onto a conventional path — a
scratch area onto `/scratch`, a shared application tree onto a module path, a home
directory cache onto `/home`. It is convenient and it introduces a specific,
serious failure mode.

**A process whose current working directory is under a bind mount does not follow
that mount when it is re-established.** Tear the bind down and put it back, and the
process's CWD is now invalid. `getwd()` starts returning NULL.

The consequences are not immediate and they do not point at the cause:

- The job does **not** die at the moment of the remount. It dies at its next call
  that needs the working directory, which may be minutes later.
- The error surfaces deep inside application code. In R, for instance, a library
  that saves and restores the working directory around a compile step fails with
  `Error in setwd(cur) : character argument expected`, because `cur` is NULL. The
  message names the application's function. It reads unmistakably like a user bug.
- Slurm marks the job FAILED rather than requeuing it, because from the scheduler's
  point of view the job exited non-zero of its own accord.

A rolling restart of a bind-mount unit across a compute fleet, with jobs running,
kills every job that has a working directory under that path. In one measured case
a sequential loop across eighteen nodes produced a 100% mortality rate among the
jobs it touched — every job spanning its node's restart failed, none survived —
while the naive correlation test ("did jobs fail within sixty seconds of the
restart?") found almost nothing and would have exonerated the change entirely. The
correct test is whether the restart fell **inside** each job's start-to-end window.

The rules that follow from this:

1. **Drain the node before touching a bind mount.** Treat it exactly as you would a
   reboot. `scontrol update NodeName=<n> State=DRAIN`, wait for the node to empty,
   make the change, verify with `findmnt`, resume.
2. **Never loop across a fleet without a per-node gate.** Restarts spaced a few
   seconds apart are the signature of a script with no check in it.
3. **A bind restart is in one respect worse than a reboot.** A reboot kills jobs
   visibly and the scheduler requeues them. A bind restart corrupts the state of
   surviving processes, which then fail later with an error that blames the user.
4. If a fleet-wide change genuinely cannot wait for an empty cluster, the honest
   options are a maintenance reservation or announcing the job losses. A silent
   rolling loop is neither.

## Validate the client side

```bash
mmmount all -a
mmlsmount all -L                       # who has it mounted
mmdf gpfs0                             # capacity as the client sees it
mmdiag --network                       # RDMA in use, not TCP
findmnt -no SOURCE /gpfs/gpfs0         # the mount, not the unit state
```

Then test as a user, not as root. Many sites export storage through NFS with
root-squash somewhere in the path, and a root test that succeeds proves less than a
user test that fails.

Confirm on **every** class of node, not a sample. Head and login nodes frequently
differ from compute nodes in ways nobody documented — a local directory shadowing a
shared mount, a different module tree, an export that was never extended to the
control plane. A configuration checked only on the head node is a configuration
checked on the one machine that is least representative of where jobs run.

## Day-2 failures worth recognising

**A node that mounts but performs badly.** Check `verbsPorts` and RDMA state first;
silent TCP fallback is the most common cause and the least visible.

**A node that will not mount after rejoining.** Per-node configuration —
`verbsPorts`, `pagepool`, licence designation — is not inherited by `mmaddnode`.
Compare a working node against the new one line by line.

**Automount not mounting.** `-A yes` mounts at daemon start. If the daemon started
before the network was ready, the mount fails and does not retry on its own.
Ordering the GPFS unit after `network-online.target` avoids it.

**Contact nodes all down.** Clients cannot mount if none of the `-n` contact nodes
answer, even when the rest of the storage cluster is healthy. Keep the list
current: a contact node that was decommissioned two years ago is a mount failure
waiting for a coincidence.

**Stale mounts after a storage-side event.** If the storage cluster force-unmounts,
clients can be left with a mount point that exists but does not work. The GPFS mount
callback described in the companion ECE guide is the reliable repair; systemd will
not notice on its own.

## The pattern underneath all of these

Every failure in this guide has the same shape. The command returned success. The
configuration file says the right thing. The systemd unit reports `active`. And the
running state is different.

The habit that prevents most of it is cheap: after any change, check the thing
itself rather than the thing that describes it. `findmnt` rather than
`systemctl is-active`. `mmfsadm dump config` rather than `mmlsconfig`. A job run as
a user rather than a command run as root. `mmdiag --network` rather than the
`verbsPorts` setting you just made.
