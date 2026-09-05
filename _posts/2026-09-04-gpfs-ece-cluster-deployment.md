---
title: "Deploying a GPFS ECE cluster, end to end"
date: 2026-09-04 09:00:00 -0400
category: Storage
tags: [GPFS, Storage Scale, ECE, Erasure coding, Deployment]
summary: >-
  Erasure Code Edition turns commodity servers with internal NVMe into a parallel
  filesystem with no external RAID. The install is well documented. The decisions
  that are expensive to reverse are not, and most of them are made in the first
  hour.
---

Erasure Code Edition (ECE) runs IBM Storage Scale's declustered RAID in software,
across the internal drives of ordinary servers. There is no controller, no external
array, and no appliance. You get the ESS data protection model on hardware you
specify yourself.

The installation itself is mechanical and IBM documents it well. What follows
concentrates on the decisions that are cheap to make correctly on day one and
painful to revisit later, and on the failures that are hard to diagnose because the
system reports success while doing the wrong thing.

## Decide whether ECE is the right answer at all

ECE earns its place when you want parallel-filesystem performance from servers you
control, and you have a fast private network to spend on it. It is the wrong answer
in three cases.

**Too few nodes.** The documented minimum is four servers per recovery group. Four
is a number you can build, not a number you should run — see the fault tolerance
arithmetic below. Six is a sensible floor and eight or more is where the model
starts behaving the way the marketing describes.

**Mixed hardware inside a recovery group.** Every server in a recovery group should
be the same model with the same drive count, drive model, CPU and memory. ECE
distributes strips on the assumption that servers are interchangeable. They do not
have to match across recovery groups, but within one they effectively do.

**No dedicated fast network.** ECE reads amplify. Delivering one byte to a client
moves roughly 1.875 bytes on the storage fabric with an 8+2p code, because
reconstructing a block gathers strips from every other server. If that traffic
shares a congested network with everything else, you have built an expensive way to
be slow.

## Get the fault tolerance arithmetic right before you buy anything

This is the single decision most likely to be regretted, and it is made before a
single package is installed.

Fault tolerance is not the `p` in the code name. A code writes a fixed number of
strips, and those strips land on distinct servers. If the strip count exceeds the
server count, some server necessarily holds two strips of the same stripe, and
losing that one server costs you two strips.

| Code | Strips | Servers | Strips per server | Node fault tolerance |
|---|---|---|---|---|
| 8+2p | 10 | 8 | some hold 2 | **1** |
| 8+2p | 10 | 11+ | 1 | 2 |
| 4+2p | 6 | 8 | 1 | **2** |
| 4+3p | 7 | 8 | 1 | 3 |

An 8+2p array on eight servers gives you **node fault tolerance of 1**. That is not
a theoretical concern:

- One server down and you are one failure from data loss.
- More immediately, **`mmvdisk` refuses to suspend a server** while any vdisk in
  the recovery group sits at fault tolerance 1. Every maintenance action that needs
  a server offline — firmware, kernel updates, a BIOS setting, a physical move — is
  blocked. Not warned about: blocked.

The cost of fault tolerance 2 is capacity. A 4+2p code writes six strips for four
of data, so usable capacity is raw divided by 1.5. An 8+2p code divides by 1.25.
On the same hardware, moving from 8+2p to 4+2p costs you a fifth of your usable
space and buys you the ability to service the cluster.

Decide this deliberately. Converting later means building a second filesystem
alongside the first and copying everything across, which needs enough free capacity
to hold both.

## Validate the hardware before you install anything

IBM publishes two readiness tools in the SpectrumScaleTools repository:
`ece_network_readiness` and `ece_storage_readiness`. Run both before installing.
They check the things that will otherwise be discovered as a performance mystery
three weeks later.

The thresholds worth knowing, because you can check them yourself:

| Measure | Threshold |
|---|---|
| ICMP latency between storage nodes, average | ≤ 1 ms |
| ICMP latency, maximum | ≤ 2 ms |
| ICMP standard deviation | ≤ 0.333 ms |
| NVMe random 128 KiB IOPS, per drive | > 15,000 |
| Single-client read throughput | > 2,000 MB/s |

A cluster that misses the latency numbers will work and will never perform. The
standard deviation matters more than the average — jitter on the storage network
shows up as unexplained tail latency in every job on the cluster.

## Prepare the operating system

**Pin the kernel.** ECE builds a portability layer against the running kernel. An
unplanned kernel update on one node produces a node that will not start `mmfsd`
until you rebuild. Exclude kernel packages from routine updates and treat kernel
changes as a scheduled activity with a rebuild step.

**Name devices by path, not by enumeration.** NVMe controllers are probed
asynchronously. The device that is `/dev/nvme4n1` today may be `/dev/nvme1n1` after
a reboot, and the mapping is not stable across identical servers. Any configuration
that names `/dev/nvmeXnY` — a disk setup definition, a script, a monitoring check —
is a latent failure that surfaces at the worst time, which is during a reboot you
performed for an unrelated reason.

Use `/dev/disk/by-path/` or the WWN. ECE itself identifies drives by their unique
identifier and is unbothered; it is the tooling around ECE that breaks.

A related trap: with NVMe native multipath, block devices sit under a virtual
subsystem and have no PCI parent. Reading a PCI address from the block device
returns nothing. The address lives on the controller, at
`/sys/class/nvme/nvmeN/address`. A validation script that reads the wrong path
returns empty and, if written carelessly, reports success.

**AMD EPYC platforms need two specific fixes.** On family 23 and 25 processors,
`mmaddnode` and `mmstartup` can hang for twenty to thirty minutes at 99% CPU inside
the GSKit cryptographic library. The fix is documented by IBM as APAR IJ47407 and
amounts to setting `ICC_SHIFT=3` in the ICCSIG configuration. Bake it into the
image; discovering it per node is a slow way to build a cluster.

Separately, some Genoa-based platforms panic on late microcode load. If you see
kernel panics on nodes that otherwise boot, add `dis_ucode_ldr` to the kernel
parameters and load microcode from the firmware instead.

## Create the cluster

Install `gpfs.base`, `gpfs.gpl`, `gpfs.ece` and the licence packages, then build the
portability layer with `mmbuildgpl`. Do this on every node before creating the
cluster, not as part of it.

```bash
mmcrcluster -N nodefile -r /usr/bin/ssh -R /usr/bin/scp -C ece-cluster
mmchlicense server --accept -N all
```

Quorum design is worth a moment. Use an odd number — three for most clusters, five
for large ones. Quorum nodes should be spread across failure domains: racks, power
feeds, and switches. A three-node quorum with all three in one rack is a
single-rack outage away from a filesystem that will not mount.

Designate manager nodes explicitly rather than letting every server carry the role.
On a storage cluster the servers are busy; giving the manager role to all of them
means a manager failover happens under exactly the conditions where you least want
extra work.

## Configure the network, and verify it is actually being used

This is where clusters silently underperform.

`verbsPorts` tells GPFS which RDMA devices to use. Set it, then confirm it took:

```bash
mmlsconfig verbsPorts                 # what is stored
mmfsadm dump config | grep -i verbs   # what is running
mmdiag --network | grep -E "by (TCP|RDMA) connection"
mmfsadm test verbs conn               # per-peer RDMA counters
```

Three failure modes, all of which present as "it works, but slowly":

**Per-node overrides are not inherited.** A node added later with `mmaddnode` does
not pick up a per-node `verbsPorts` setting. It falls back to the cluster default,
and if that default names a device the new node does not have, GPFS quietly uses
TCP over IPoIB instead. Throughput drops by a factor you will notice; nothing logs
an error. Check `verbsPorts`, `pagepool` and the licence designation after **every**
node addition or rejoin.

**Pointing at the wrong port type.** A dual-port adapter may present one InfiniBand
port and one Ethernet/RoCE port. A global default of `mlx5_1/1` aims GPFS at
whichever port happens to be second, which on some platforms is the RoCE port.
Check `link_layer` in sysfs before trusting a device name.

**The negotiated rate is not what you ordered.** `iblinkinfo` reports the per-lane
rate, not the link rate. `4X 106.25 Gbps` is NDR400; `4X 53.125 Gbps` is HDR200;
`2X 53.125 Gbps` is a half-width HDR100 link that will gate every synchronised
operation across the cluster. The authoritative per-host view is
`/sys/class/infiniband/<dev>/ports/1/rate`. Check every node, not a sample — one
degraded link is enough to make an entire benchmark meaningless, and it will be
blamed on the filesystem.

## Build the recovery group

```bash
mmvdisk nodeclass create --node-class NC_ECE -N storage01,storage02,...,storage08
mmvdisk server configure --node-class NC_ECE --recycle one
mmvdisk recoverygroup create --recovery-group RG1 --node-class NC_ECE
```

`mmvdisk server configure` sets the server-side parameters, including `pagepool`
and the RAID buffer pool percentage, and `--recycle one` restarts daemons one at a
time to apply them.

**Confirm the recycle actually completed.** `pagepool` takes effect only on daemon
restart. A configured value with no completed restart leaves the cluster running the
old value indefinitely, and `mmlsconfig` will happily report the new one. The
running value is in the daemon's own log at every start, and in `mmdiag --config`.
A cluster running months on a fraction of its intended pagepool is not a
hypothetical failure; the symptom is mediocre write performance that no tuning
fixes.

## Define vdisk sets, and read the size units carefully

```bash
mmvdisk vdiskset define --vdisk-set VS1 --recovery-group RG1 \
        --code 4+2p --block-size 2M --set-size 100T
mmvdisk vdiskset create --vdisk-set VS1
mmvdisk filesystem create --file-system fs1 --vdisk-set VS1
```

`--set-size` is **usable** capacity, not raw. Requesting 150 TiB at 4+2p consumes
225 TiB of raw space, and the command fails with "not enough space" on an array
that appears to have plenty. Multiply by the code's expansion factor before you ask.

Two more things that are difficult to change afterwards:

**Block size changes the subblock count, not the subblock size.** Moving from 4 MiB
to 2 MiB blocks takes you from 512 subblocks to 256, both of 8 KiB. Small-file
efficiency is unchanged. If you are rebuilding a filesystem in the belief that a
smaller block size will help small files, check `mmlsfs -f` first and confirm the
subblock size you expect.

**`mmvdisk vdiskset list` prints per-vdisk size, not set totals.** A set of sixteen
vdisks showing "81 TiB" is 1.27 PiB. Misreading that column is a straightforward way
to conclude a filesystem is nearly full when it is under ten per cent used.
Allocation is not utilisation: a declustered array can be 99% *allocated* to vdisk
sets while the filesystem on top is nearly empty.

## Tune, and verify each change actually applied

`mmchconfig` returning success means the value is stored. It does not mean the value
is in effect, and for several parameters it does not mean the value will ever be in
effect.

```bash
mmlsconfig <param>                        # stored
mmfsadm dump config | grep -i <param>     # running   <- the one that matters
```

In `mmfsadm dump config`, `!` marks a value differing from default, and `*` marks
one changed at runtime. A value that appears with `!` but never with `*` may have
been accepted and discarded.

Parameters worth setting, with measured effect on an NVMe ECE cluster:

| Parameter | Effect |
|---|---|
| `pagepool` (servers) | Large. Shared-file writes improve substantially; file-per-process much less, because it was never buffer-starved |
| `maxMBpS` | ~6% on writes, nothing on reads |
| `workerThreads`, `prefetchThreads` | ~3% on writes |
| `nsdRAIDBufferPoolSizePct` | Sets the RAID buffer; leave at the configured default unless you have a reason |

Parameters that are accepted and do nothing on current versions. These are
documented here so nobody spends a rolling restart proving it again:

| Parameter | Why it does nothing |
|---|---|
| `verbsRdmasPerNode` | Supported in 4.2.x only. Runtime value stays 0 |
| `verbsRdmasPerConnection` | Obsolete since 5.0. Stored, discarded at runtime |
| `nsdRAIDThreadsPerQueue` | No measurable effect |
| `verbsNumSendChannel`, `verbsNumRecvChannel` | No measurable effect |
| `verbsRdmaMaxSendBytes` | No measurable effect |
| `verbsRdmaSend` | Genuinely moves RPCs from TCP to RDMA — and changes throughput not at all. It governs daemon-to-daemon traffic, not the data path |

## Make the cluster repair its own mounts

Anything bind-mounted over a GPFS path — a scratch directory, a module tree, a
shared application area — is torn down when the filesystem goes away and is **not**
re-established when it returns. A systemd unit with `BindsTo=gpfs.service` covers a
service restart but not an `mmshutdown`/`mmstartup` cycle, because the filesystem
can disappear and return without the service unit changing state.

GPFS knows when the filesystem mounts even when systemd does not. Register a
callback:

```bash
mmaddcallback ScratchBind \
  --command /usr/local/sbin/gpfs-post-mount.sh \
  --event mount --parms "%fsName"
```

Three details decide whether this works:

- **Match every device name the filesystem is known by.** If the filesystem is ever
  renamed, `%fsName` changes and a guard written against the old name exits
  silently. Accept both, and log any name you do not recognise, so the next rename
  leaves evidence instead of a silent outage.
- **Make the script idempotent and fast.** A slow callback delays the mount for
  every node.
- **`RemainAfterExit=yes` is load-bearing** on any `Type=oneshot` bind unit.
  Without it, systemd deactivates the unit the instant `ExecStart` returns and runs
  `ExecStop` as part of that normal deactivation — the unit binds the path and
  unbinds it a second later.

Be aware of the corollary: `systemctl is-active` on such a unit reports `active`
whether or not the bind exists. Check the mount, with `findmnt -no SOURCE <path>`,
never the unit state.

## Validate with numbers that survive scrutiny

**Size the dataset from the cache, not from convenience.** Client-side `O_DIRECT`
bypasses the client pagepool but not the servers' RAID buffer pool. That buffer is:

```
pagepool × nsdRAIDBufferPoolSizePct × number_of_servers
```

Eight servers with a 128 GiB pagepool at 80% is roughly 800 GiB of read cache. A
read benchmark smaller than that measures memory. The error is large — a test that
reports 155 GiB/s cached can be 82 GiB/s cold. Size reads at several times the
buffer and confirm by re-running at double: if the number drops, you were measuring
cache.

**Do not mistake under-driving for a ceiling.** Too few outstanding I/Os looks
exactly like a hard limit. Sweep concurrency; a genuinely saturated system is flat
across 64, 96, 128 and 192 jobs, while an under-driven one climbs. Sweep node count
too, since a per-node limit and an aggregate limit are different problems with
different fixes.

**Check the fabric before tuning the filesystem.** If clients and servers sit on
different switches, measure the inter-switch links under load before changing a
single GPFS parameter. Static InfiniBand routing pins each destination to one
output port, and it can collapse many links into a few in one direction while the
other direction spreads perfectly. The signature is a large read/write asymmetry
with nothing apparently saturated, and no amount of GPFS tuning touches it.

`nsdperf` exercises the NSD protocol with no disk layer at all, which separates
network from storage in one test. If `nsdperf` and your filesystem report similar
numbers, the bottleneck is at or below the network and no tunable will help.

## Restart the cluster without an outage

Many parameters need a daemon restart, which on a storage cluster means restarting
servers underneath a live filesystem. Done with gates it is routine.

Refuse to start unless all of these hold, and re-check them between every node:

- every server `active`
- recovery group needs service: `no`
- all pdisks `ok`
- no rebuild or rebalance running
- **fault tolerance still at its design value** — this is the safety budget
- the filesystem still mounted on a client

Order matters: non-quorum nodes first to prove the procedure, then quorum nodes one
at a time, and the recovery group master **last** so you do not trigger a pointless
master failover at the start.

Run it detached — `setsid nohup ... &`. An administrator's dropped SSH session
should not be able to leave a storage node down with no orchestration.

## The failures worth recognising on sight

**"Node appears to already belong to a cluster."** Usually a stale `mmsdrserv`
process on the node from a previous attempt. Kill it and retry; reinstalling the
node is not required.

**A node that answers SSH but has no `/var/mmfs`.** It is sitting in a provisioning
installer environment with a read-only NFS root, not the installed OS. Probe for a
real local root before running anything against a node you have just rebooted.

**Reading the filesystem mounts it.** `mmlsfs` and `mmrepquota` trigger an internal
mount. Doing a record-keeping step immediately before an unmount gate makes that
gate fail, and the internal mounts are not visible as user processes — `fuser` shows
only kernel threads. Record first, force-unmount second, gate third. `mmchfs -T`
requires zero mounts including internal ones, and a plain `mmumount -a` does not
guarantee that.

**Fileset inode limits do not carry across.** A fileset created on a new filesystem
defaults to a little over 100,000 inodes regardless of what the source held. A
migration that copies millions of files into it dies partway with no obvious cause.
Set `--inode-limit` at creation.

**Snapshots cannot be migrated.** They live with the filesystem. If a rebuild is
planned and any rollback history matters, extract it first; the new filesystem
starts with none.

## What to watch once it is running

`mmhealth` covers the basics. Beyond it, the signals that catch real problems early:

- **long waiters** — `mmdiag --waiters`; anything over 30 seconds repeatedly is a
  stuck subsystem, not a busy one
- **server queue depth** — `mmfsadm dump nsd | grep -E "pending|active"`. Queues
  reporting `pending 0` under load mean the servers are starved and the bottleneck
  is upstream. This one measurement short-circuits most performance investigations
  and is worth taking first, not last
- **RDMA actually in use** — `mmdiag --network`, per the earlier warning
- **pdisk state and fault tolerance** — a background rebuild is normal; a fault
  tolerance that has dropped and stayed down is not
- **config versus running state** — periodically diff `mmlsconfig` against
  `mmfsadm dump config`. Divergence is silent and accumulates

The last one deserves emphasis. Nearly every long-running problem described here
shares a shape: the system reported success, the configuration said one thing, and
the running state said another. Build the habit of checking the second one.
