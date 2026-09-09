---
title: "Multi-rail MPI: making the second adapter carry its share"
date: 2026-09-08 09:00:00 -0400
category: Fabric
tags: [MPI, UCX, Multi-rail, NUMA, RDMA]
summary: >-
  A second rail is bought as a doubling and usually arrives as something well
  short of it. The reasons are enumerable, most of them are in the host rather
  than the fabric, and the first thing to establish is whether MPI is using the
  second adapter at all.
---

Dual-rail hosts are now the default on anything built for AI and common on
general HPC nodes. Two adapters, two cables, two ports on the leaf, and a
reasonable expectation that a bandwidth-bound job goes twice as fast.

It rarely does, and the gap between what was bought and what arrives is
attributed to fabric overhead far more often than it deserves. In practice, the
second rail underdelivers for one of a short list of reasons, most of which are
inside the node and all of which are measurable.

## First: is the second rail carrying anything at all?

Before tuning anything, establish whether the second adapter is being used. This
is not a rhetorical question — a substantial fraction of dual-rail nodes in
production are running every byte over one rail, and nothing reports it.

The direct method is the port counters. Clear, run, read:

```bash
for d in mlx5_0 mlx5_1; do
  echo -n "$d before: "
  cat /sys/class/infiniband/$d/ports/1/counters/port_xmit_data
done

mpirun -np 2 -map-by ppr:1:node ./osu_bw -m 8388608:8388608

for d in mlx5_0 mlx5_1; do
  echo -n "$d after: "
  cat /sys/class/infiniband/$d/ports/1/counters/port_xmit_data
done
```

If `mlx5_1` did not move, you have a single-rail cluster with a spare adapter in
it. That is a two-minute check and it settles the question that the rest of the
work depends on.

<div class="note" markdown="1">
Do this check before any tuning conversation. A node whose second adapter has
never transmitted a byte is not a multi-rail tuning problem, and the discussion
about striping thresholds and rendezvous rails that usually follows is entirely
beside the point. The counter delta settles it in two minutes.
</div>

The second method is to ask UCX what it selected:

```bash
mpirun -np 2 -map-by ppr:1:node \
  -x UCX_LOG_LEVEL=info \
  ./osu_bw 2>&1 | grep -iE 'selected|device|transport|rndv'
```

Recent UCX releases also expose a protocol selection table that is considerably
more readable than the log:

```bash
mpirun -np 2 -x UCX_PROTO_INFO=y ./osu_bw
```

It prints, per message-size range, which protocol and which devices UCX will
use — including whether a large rendezvous transfer is being striped across
multiple devices or sent over one. That table answers the multi-rail question
directly rather than by inference.

## Telling MPI which devices to use

UCX enumerates devices itself and its default selection is often not what you
want, particularly on a node that also has a management NIC, a storage NIC, or
an adapter whose port is administratively down.

```bash
ucx_info -d | grep -E '^#.*Transport|Device:'
ucx_info -v
```

The device list to hand to MPI is explicit and includes the port number:

```bash
mpirun -np 16 -map-by ppr:8:node --bind-to core \
  --mca pml ucx --mca osc ucx \
  -x UCX_NET_DEVICES=mlx5_0:1,mlx5_1:1 \
  -x UCX_TLS=rc_x,sm,self \
  ./osu_bw
```

Three parameters do most of the work:

- `UCX_NET_DEVICES` — the allowlist. Naming devices explicitly is better
  practice than relying on discovery, because discovery changes when a port goes
  down or a card is added.
- `UCX_MAX_RNDV_RAILS` — how many devices a single large (rendezvous) transfer
  may be striped across. The default has historically been 2. If you have four
  rails and want them all used by one transfer, this is the setting that is
  quietly capping you.
- `UCX_MAX_EAGER_RAILS` — the same idea for the eager protocol used by smaller
  messages.

Confirm the values in effect rather than assuming the defaults:

```bash
ucx_info -f -c | grep -E 'MAX_RNDV_RAILS|MAX_EAGER_RAILS|NET_DEVICES|TLS'
```

## Why the second rail underdelivers

Work through these in order. They are roughly ordered by how often they are the
answer.

**The transfer is not big enough to stripe.** Rail striping applies to the
rendezvous protocol. Messages below the rendezvous threshold go over one device.
An application whose messages are all 64 KB will not benefit from a second rail
no matter how it is configured, and that is a correct outcome rather than a
misconfiguration. Check where your application's message sizes sit before
concluding anything.

**Both adapters are on the same NUMA node.** Two cards on one socket share that
socket's PCIe root complex, its memory bandwidth, and its inter-socket link for
any traffic sourced from the other socket. Check:

```bash
for d in /sys/class/infiniband/mlx5_*; do
  echo "$(basename $d): numa_node=$(cat $d/device/numa_node)"
done
lstopo --output-format txt
nvidia-smi topo -m     # on GPU nodes: also shows GPU-to-HCA affinity
```

`nvidia-smi topo -m` is the one to read on a GPU node. `PIX` means the GPU and
the adapter sit under the same PCIe switch, which is the case GPUDirect RDMA is
designed for. `NODE` means same NUMA node but traversing the root complex.
`SYS` means the traffic crosses the inter-socket link, and on that pairing the
second rail is a good deal less than a second rail.

**The ranks are not bound to the rail that is local to them.** This is the
common and fixable case. If every rank uses both rails, half of every node's
traffic crosses the inter-socket link. The better arrangement on a two-socket,
two-rail node is that ranks on socket 0 use `mlx5_0` and ranks on socket 1 use
`mlx5_1`, with no striping at all. That is not multi-rail in the striping sense;
it is rail affinity, and it usually outperforms naive striping.

A small wrapper does it, driven by the local rank the launcher exports:

```bash
#!/bin/bash
# rail-bind.sh - one rail per socket, selected by node-local rank
local_rank=${OMPI_COMM_WORLD_LOCAL_RANK:-${SLURM_LOCALID:-0}}
half=$(( OMPI_COMM_WORLD_LOCAL_SIZE / 2 ))
if [ "$local_rank" -lt "$half" ]; then
  export UCX_NET_DEVICES=mlx5_0:1
else
  export UCX_NET_DEVICES=mlx5_1:1
fi
exec "$@"
```

```bash
mpirun -np 32 -map-by ppr:8:numa --bind-to core ./rail-bind.sh ./osu_mbw_mr
```

Measure both arrangements. Which wins depends on the message-size distribution
and on whether the application is bandwidth- or latency-bound, and it is not
predictable from the topology alone.

**The PCIe slots cannot carry it.** Two NDR400 adapters is 100 GB/s of offered
load in each direction. Confirm both slots trained to their rated speed and
width, and confirm the platform is not sharing lanes between them:

```bash
lspci -vv | grep -A1 Mellanox | grep -E 'LnkCap|LnkSta'
```

**Both rails land on the same leaf switch and the same uplinks.** This is the
fabric-side case, and it is why some sites deliberately build the second rail as
a separate subnet with its own switches and its own subnet manager. If both
rails leave the node, arrive at the same leaf, and take the same uplinks to the
spine, the second rail doubles the host's egress capacity and does nothing for
the fabric's ability to carry it. Check where each rail's port actually lands:

```bash
ibnetdiscover | grep -A2 "$(ibstat mlx5_0 | awk '/Port GUID/{print $3}')"
iblinkinfo -l | grep -iE 'node01'
```

**The application is not bandwidth-bound.** A latency-bound code gains nothing
from a second rail and may lose a little to the extra selection logic. This is
the outcome nobody wants to hear and it is frequently the correct one. It is
also the argument for measuring with `osu_mbw_mr` at your application's real
message sizes rather than with a large-message `osu_bw` that flatters the
configuration.

## Proving RDMA is engaged, not TCP over IPoIB

Silent fall back to TCP over IPoIB is the single most consequential quiet
failure in this area. Everything works. The job completes. The bandwidth is
roughly a tenth of what it should be and the latency is roughly ten times what
it should be, and both of those are within the range of "the code doesn't scale
well," which is what it gets recorded as.

There are three ways to establish the truth, in increasing order of how
conclusive they are.

**Read the counters.** As above: if `port_xmit_data` on the InfiniBand device
does not move during the run, the traffic is not on the InfiniBand transport.
Corroborate on the IPoIB side, where it will have gone instead:

```bash
cat /sys/class/net/ib0/statistics/tx_bytes
```

**Read the UCX transport selection.** `UCX_PROTO_INFO=y` or
`UCX_LOG_LEVEL=info` will name the transport. Seeing `tcp` where you expected
`rc_x` or `dc_x` is the finding.

**Remove the fallback and see if it still runs.** This is the conclusive test,
and it takes one flag:

```bash
mpirun -np 2 -x UCX_TLS=rc_x,sm,self ./osu_bw
```

That list contains no TCP transport. If the job runs, RDMA was working. If it
fails to establish connections, TCP was carrying the traffic and now you know.
Run this as a gate in your acceptance suite; it converts a silent degradation
into a loud failure, which is the whole objective.

The usual root causes, once you have established fallback is happening:

| Cause | Check |
|---|---|
| Locked memory limit not raised | `ulimit -l` inside the job, not on the login node |
| Device down or not present on some nodes | `ibstat` across the whole allocation |
| `UCX_NET_DEVICES` naming a device that does not exist there | Node-by-node device enumeration |
| Node with a different OFED or missing `rdma-core` | `ofed_info -s` fleet-wide |
| Firewall or SELinux policy on a subset of nodes | Compare a working and a failing node |

`ulimit -l` deserves emphasis. Memory registration for RDMA requires locked
pages, and if the limit is not unlimited inside the job's environment, UCX
cannot register buffers and falls back. The limit set in `/etc/security/limits.d`
applies to login sessions; what matters is the limit inside the scheduler's
launched process, which can differ. Check it from inside a job:

```bash
srun -N 2 bash -c 'echo $(hostname) $(ulimit -l)'
```

## Rail-optimised topologies

On AI clusters the multi-rail arrangement is often not "two rails to the same
fabric" but a rail-optimised design: each GPU has an adapter, and adapter `k` on
every node connects to switch `k`. Same-index GPUs across nodes then communicate
within a single switch, which is what makes large all-reduces efficient.

Two consequences for MPI. First, the affinity between rank, GPU and adapter is
not a tuning preference, it is the design, and getting it wrong sends traffic
across the fabric that was supposed to stay in one switch. Second, if the rails
are separate subnets, each has its own subnet manager and its own LID space, and
tooling that assumes one fabric will report on one of them and silently ignore
the rest.

Verify the mapping is what the cabling intended before benchmarking anything:

```bash
nvidia-smi topo -m
for d in /sys/class/infiniband/mlx5_*; do
  n=$(basename $d)
  printf '%s numa=%s lid=%s sm_lid=%s\n' "$n" \
    "$(cat $d/device/numa_node)" \
    "$(ibstat $n 1 | awk '/Base lid/{print $3}')" \
    "$(ibstat $n 1 | awk '/SM lid/{print $3}')"
done
```

## What to measure, and in what order

1. `ib_write_bw -d mlx5_0` and `-d mlx5_1` separately. Each rail alone should
   reach the same number. If one is lower, stop — that is a link or slot problem
   and it is not a multi-rail question.
2. Both rails simultaneously, as two concurrent `ib_write_bw` processes pinned to
   the correct sockets. This is the host's true aggregate ceiling and it is the
   number multi-rail MPI is trying to reach.
3. `osu_bw` with one rail, then with both. Compare against step 2.
4. `osu_mbw_mr` at your application's message sizes, one rail versus both, with
   and without rail affinity.

Step 2 is the one that gets skipped, and it is the one that tells you whether the
shortfall is in the host or in MPI. If two concurrent `ib_write_bw` processes
cannot reach twice a single rail, no MPI configuration will, and you have a
PCIe, NUMA or memory-bandwidth investigation rather than a UCX one.
