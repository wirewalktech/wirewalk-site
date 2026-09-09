---
title: "An MPI troubleshooting playbook: symptom to cause"
date: 2026-09-09 10:00:00 -0400
category: Fabric
tags: [MPI, UCX, PMIx, Troubleshooting, RDMA]
summary: >-
  Hangs, stragglers, silent TCP fallback, launcher failures and results that
  change between runs. Each has a small set of causes and a command that
  distinguishes them, and most of the time lost is spent on the wrong layer.
---

This is the reference half of the series. The earlier articles argue for testing
in a particular order; this one is the lookup table for when something is already
broken and you need the shortest path to a cause.

The single most useful habit underneath all of it: **capture the node list, the
environment and the module versions with every run**. Most of the diagnoses below
are trivial with that information and genuinely difficult without it.

## The index

| Symptom | Most likely causes | First command |
|---|---|---|
| Hangs at `MPI_Init` | PMIx mismatch, launcher, hostfile | `mpirun --mca plm_base_verbose 10` |
| Hangs at first collective | QP setup, memlock, one unreachable node | `srun -N all bash -c 'ulimit -l'` |
| Runs, but ~10x slow | Silent TCP fallback | `UCX_TLS=rc_x,sm,self` |
| Fails only above N ranks | RC queue-pair exhaustion, registration memory | `UCX_TLS=dc_x,sm,self` |
| One rank always late | Degraded link, throttled node, stray daemon | Pairwise `ib_write_bw` sweep |
| Timings vary run to run | Allocation varies, shared ISLs, jitter | Record and compare node lists |
| Bandwidth exactly half | Width negotiation, PCIe width, single rail | `iblinkinfo`, `lspci -vv` |
| `Retry exceeded` errors | Fabric drops, RoCE PFC/ECN, dead peer | Port counters, `ethtool -S` |
| Worse after a maintenance window | Firmware skew, routing engine fell back | `ibv_devinfo` fleet-wide, SM log |

Everything below expands one row.

## Hangs at startup

A job that never reaches the application is a launcher problem, not a fabric
problem, and the fabric tooling will waste your time here.

```bash
mpirun --mca plm_base_verbose 10 --mca rmaps_base_verbose 5 -np 4 hostname
```

That prints the launch sequence as it happens, and the point at which it stops is
the diagnosis. Common stopping points:

**Cannot reach a node.** The launcher uses SSH or the scheduler's own launch
mechanism. If it is SSH, key-based access between compute nodes must work
non-interactively, and on a cluster with `pam_slurm_adopt` it must work *from
within an allocation*, which is not the same test as from the login node.

**PMIx version mismatch.** This is the common one on schedulers, and it produces
either a hang or an error naming PMIX. Slurm and Open MPI are each built against
a PMIx, and if the two disagree, `srun`-launched MPI jobs fail while
`mpirun`-launched ones work, or vice versa. Establish what each side has:

```bash
srun --mpi=list
ompi_info | grep -iE 'pmix|prrte'
pmix_info --version
```

Then be explicit rather than relying on the default:

```bash
srun --mpi=pmix -N 2 -n 4 ./a.out
```

If `srun --mpi=list` does not offer a PMIx entry, Slurm was not built with PMIx
support and `mpirun` under an allocation is your path.

**"There are not enough slots available in the system."** The hostfile or the
scheduler allocation says fewer slots than `-np` asked for. Under a scheduler,
this usually means `mpirun` did not pick up the allocation. `--oversubscribe`
silences it and does not fix it; check `$SLURM_JOB_NODELIST` and
`$SLURM_NTASKS` instead.

## Hangs at the first collective

Startup succeeded, ranks exist, and the job stops the first time they all have to
talk. This is connection establishment.

**Locked memory limit.** RDMA needs pinned pages. If the limit is not unlimited
inside the job, registration fails. The limit that matters is the one inside the
launched process, which is not necessarily the one in
`/etc/security/limits.conf`:

```bash
srun -N 8 --ntasks-per-node=1 bash -c 'echo $(hostname) $(ulimit -l)'
```

Anything other than `unlimited` on any node is the answer.

**A node that is up but has no working adapter.** The job launches everywhere and
then waits for the one rank that cannot connect. Check the whole allocation
rather than a sample:

```bash
srun -N $SLURM_NNODES --ntasks-per-node=1 bash -c \
  'echo "$(hostname) $(ibstat mlx5_0 1 | awk "/State:/{print \$2}" | head -1)"'
```

**Firewall on the fabric interface.** Rare on InfiniBand, common on RoCE, where
the traffic is UDP and a host firewall will happily block port 4791.

To see where it is stuck rather than guessing, attach to a hung rank:

```bash
pstack $(pgrep -n a.out)          # or: gdb -p <pid> -batch -ex bt
```

A stack sitting in a UCX progress or connection-establishment function is a
transport problem. A stack in application code is not.

## Silent fall back to TCP

The most expensive quiet failure in MPI, because nothing is broken. The job
completes, the numbers are bad, and the conclusion recorded is that the
application does not scale.

The signature is quantitative: bandwidth roughly an order of magnitude below the
link rate and small-message latency roughly an order of magnitude above what the
fabric should give. If a two-node `osu_bw` on a 200 Gb/s fabric reports a couple
of gigabytes per second, stop tuning and check the transport.

The conclusive test removes the fallback:

```bash
mpirun -np 2 -x UCX_TLS=rc_x,sm,self -x UCX_NET_DEVICES=mlx5_0:1 ./osu_bw
```

No TCP transport is listed. If the job runs, RDMA was working and the problem is
elsewhere. If it fails to establish connections, TCP was carrying the traffic.

Corroborate by watching the device counters move — or not — during a run:

```bash
before=$(cat /sys/class/infiniband/mlx5_0/ports/1/counters/port_xmit_data)
mpirun -np 2 -map-by ppr:1:node ./osu_bw -m 8388608:8388608 >/dev/null
after=$(cat /sys/class/infiniband/mlx5_0/ports/1/counters/port_xmit_data)
echo "delta: $(( after - before ))"
```

Causes, in the order they are usually found: `ulimit -l` not unlimited; a device
name in `UCX_NET_DEVICES` that does not exist on some nodes; a node with a
different OFED; a port that is down on one node; and, on GPU nodes, a CUDA-aware
build mismatch that causes UCX to reject the RDMA path for device buffers.

<div class="note" markdown="1">
Put the `UCX_TLS=rc_x,sm,self` run in your acceptance suite as a pass/fail gate.
It costs seconds and it converts the single most damaging silent degradation into
a loud, obvious failure. Almost nobody does this, and it is the highest-value
five lines in an MPI test harness.
</div>

## Fails only above a certain scale

A job that works at 8 nodes and fails at 64 is usually a resource that scales
with the square of the rank count.

**Reliable Connection queue pairs.** With RC, each rank maintains a QP to each
peer it talks to. Full connectivity across `n` ranks is `n²` QPs, and each
consumes adapter and host resources. On a node running many ranks, this becomes
the constraint well before the fabric does.

Dynamically Connected transport solves it by multiplexing:

```bash
mpirun -x UCX_TLS=dc_x,sm,self -x UCX_NET_DEVICES=mlx5_0:1 ./a.out
```

If a job fails at high ranks-per-node with connection or resource errors and
succeeds with `dc_x`, that was it. Note that DC availability depends on the
adapter generation, and that the failure mode when DC resources themselves are
exhausted is different and less obvious — usually a hang rather than an error.

**Memory registration limits.** Large registered regions need translation table
entries. The relevant firmware parameters differ by adapter and driver
generation; the symptom is a registration failure at a size or rank count that
worked before.

**Aggregate memory per node.** Each connection carries buffers. At high
ranks-per-node, MPI's own buffer footprint becomes significant, and the job dies
of OOM in a way that looks like an application memory bug. `dmesg` on the node
that died settles it in one line.

## One rank is always late

A collective takes as long as its slowest participant, so one degraded node
degrades everything. Finding it is mechanical.

Bisection is fastest: split the allocation, run both halves, keep the slow half,
repeat. Six rounds for 64 nodes.

The systematic version tests every node against one reference, at the verbs layer
so MPI is not in the picture:

```bash
REF=node001
for n in $(scontrol show hostnames $SLURM_JOB_NODELIST); do
  [ "$n" = "$REF" ] && continue
  bw=$(ssh $n "ib_write_bw -d mlx5_0 -F -s 1048576 -D 5 --report_gbits $REF" \
        | awk '/1048576/ {print $4}')
  echo "$n $bw"
done | sort -k2 -n | head -5
```

Once you have the node, the causes are a short list:

- Narrow or degraded link — `iblinkinfo`, `mlxlink -d mlx5_0 -p 1 --show_fec`.
- Downtrained PCIe slot — `lspci -vv | grep LnkSta`.
- CPU frequency capping or thermal throttling — `turbostat`, `cpupower
  frequency-info`, and `dmesg | grep -i thermal`.
- A daemon on a core that a rank is pinned to.
- Memory running at a lower speed, or a DIMM that failed into a degraded
  configuration — `dmidecode -t memory`, and the platform's own health log.

On the last point about cores: **aggregate CPU idle proves nothing on a many-core
node.** One rank spinning uselessly on a 192-core machine is half a percent of
system-wide CPU. `top` shows a healthy node. Look per-core:

```bash
mpstat -P ALL 1 5
pidstat -t -p $(pgrep -n a.out) 1 5
```

## Timings vary wildly between runs

Before treating variance as a signal, establish that it is not the experiment.

**The allocation changed.** Different nodes, different leaves, different number
of spine crossings. This is the most common cause by a wide margin. Record
`scontrol show hostnames $SLURM_JOB_NODELIST` with every result and compare.

**Other jobs share the fabric.** Exclusive node allocation does not give you
exclusive links. Another job's alltoall on the same spine uplinks changes your
result, and you have no visibility into it from inside your job. If you are
producing numbers that matter, get an exclusive fabric window, or at minimum
record what else was running.

**Cached or warm state.** The first iteration of anything includes connection
setup and memory registration. Every benchmark here has a warmup flag; use it.
Where filesystem I/O is in the loop, a repeat run served from page cache is not a
measurement of anything.

**OS jitter.** Unpinned ranks, an unsynchronised housekeeping daemon, a
monitoring agent that wakes every thirty seconds. Collectives amplify jitter
because every rank waits for the one that was interrupted. `--bind-to core` and
`--report-bindings` first; if variance persists with clean binding, look at what
runs on the compute nodes on a timer.

**Power and frequency policy.** A node that boosts for the first thirty seconds
and then settles produces a benchmark whose result depends on its duration.
Fix the governor for measurement runs and record what it was.

A run-to-run spread you cannot get under a few percent is not a slow cluster. It
is an uncontrolled experiment, and no amount of tuning against it will converge.

## Bandwidth that is a clean fraction of expectation

Half, a quarter, a tenth. Clean fractions have mechanical causes and are worth a
minute of arithmetic before any investigation.

| Fraction | Look at |
|---|---|
| Exactly half | Link width 2X not 4X; one rail of two in use; PCIe x8 not x16 |
| Exactly a quarter | Link width 1X; PCIe x4; two independent halvings |
| About a tenth | TCP fallback, or IPoIB instead of RDMA |
| About 60 percent | Often real — protocol overhead plus an unsaturated single rank |

```bash
ibstatus mlx5_0 | grep rate
iblinkinfo -l | grep -v 4X
lspci -vv -s <bdf> | grep -E 'LnkCap|LnkSta'
```

## MTU

On InfiniBand, path MTU is negotiated and normally 4096. On RoCE it is derived
from the Ethernet MTU, and a single hop at 1500 anywhere in the path drops the
RoCE MTU to 1024 with a real bandwidth cost.

The `ib_write_bw` header prints what was actually negotiated, which is the number
to trust over any configuration file:

```
 Mtu             : 4096[B]
```

If that reads 1024 on a fabric you configured for jumbo frames, walk the path.
The offender is usually a recently added switch port or a host whose interface
configuration did not include the MTU.

IPoIB has its own version of this — datagram mode caps at 2044 bytes while
connected mode allows much larger — which matters if any part of your workload,
including the scheduler or the filesystem, is running over IPoIB.

## After a maintenance window

Performance that changed after a window, with no application change, has a short
suspect list.

**Firmware skew.** Some nodes were updated and some were not, or a node was
replaced with one from a different batch. Group by PSID and compare within
groups:

```bash
pdsh -w node[001-256] 'ibv_devinfo | grep -E "fw_ver|board_id"' | dshbak -c
```

**The routing engine fell back.** A switch that was down during the sweep, or a
node cabled differently on the way back in, can make `ftree` decline the topology
and fall back to `updn` for the entire fabric. The subnet manager logs it and
nobody reads it:

```bash
grep -iE 'routing engine|fallback|ftree' /var/log/opensm.log | tail -40
```

**A standby subnet manager took over.** If the standby holds an older
configuration, the whole fabric is now routed by that configuration. `sminfo`
tells you which SM is master.

**A driver or kernel change altered defaults.** UCX and OFED defaults do move
between releases. Diff the effective configuration, not the configuration files:

```bash
ucx_info -f -c > /var/tmp/ucx-$(date +%F).conf
diff /var/tmp/ucx-<previous>.conf /var/tmp/ucx-$(date +%F).conf
```

## Error messages worth recognising

**`IBV_WC_RETRY_EXC_ERR` / "Retry exceeded".** The sender gave up after
retransmitting. On InfiniBand, this usually means the peer died or a link went
down mid-transfer. On RoCE, it much more often means the fabric is dropping —
PFC not enabled on the RoCE priority, or a mismatched trust mode. Go to the
per-priority discard counters.

**`RNR retry exceeded`.** The receiver had no buffer posted and kept saying so
until the sender gave up. Usually an application or middleware issue rather than
a fabric one, though severe congestion can produce it.

**The `fork()` warning.** Registered memory and `fork()` interact badly. If your
application or a library it calls forks after registering memory, you get either
a warning or corruption. `ibv_fork_init` and the corresponding MPI settings exist
for this; a job that calls out to shell commands from inside a rank is the usual
trigger.

**`UCX ERROR ... Connection reset by remote peer`.** A peer rank died. Find out
why that rank died; the UCX error is a consequence, not a cause. Check `dmesg` on
its node for OOM.

## The habit that shortens all of this

Keep a baseline file, in version control, per cluster:

- OFED, firmware and PSID per node group
- PCIe `LnkSta` per adapter
- `ib_write_bw` and `ib_read_bw` plateaus for a named intra-leaf and cross-spine
  pair
- `osu_latency` at 8 bytes and `osu_bw` at 8 MB
- Allreduce and alltoall curves at the job sizes you run, with node lists
- The width-and-rate histogram for the whole fabric

Regenerate it after every maintenance window. Almost every diagnosis in this
article becomes a diff against that file, and a diff takes minutes where an
investigation takes days.
