---
title: "A layered order for MPI testing, and what each layer eliminates"
date: 2026-09-05 09:00:00 -0400
category: Benchmarking
tags: [MPI, InfiniBand, RDMA, perftest, Methodology]
summary: >-
  Every layer of an MPI stack has a ceiling set by the layer beneath it. Test
  from the top and you will spend a week tuning something that was never the
  constraint. Test from the bottom and most investigations end in an hour.
---

An MPI job that runs slower than expected is a question with about nine
plausible answers, spread across four layers of stack that were installed by
different people at different times. The reason these investigations run long is
almost never that the answer is subtle. It is that the search was unordered.

The discipline that fixes it is simple to state. Each layer has a performance
ceiling determined by the layer below it. Measure the bottom first, establish
what the ceiling is, and only then ask whether the layer above is achieving it.
A number at layer four means nothing until you know what layers one through
three can deliver.

## The layers

| Layer | Tool | What a clean result eliminates |
|---|---|---|
| 0. Inventory | `ibv_devinfo`, `ofed_info`, `flint`, `lspci` | Version skew, downtrained slots, wrong adapter |
| 1. Link | `ibstat`, `iblinkinfo`, `mlxlink`, `perfquery` | Width, rate, cabling, physical errors |
| 2. Verbs | `ib_write_bw`, `ib_read_bw`, `ib_send_lat` | The entire MPI and UCX stack |
| 3. MPI point-to-point | `osu_latency`, `osu_bw`, `osu_bibw`, `osu_mbw_mr` | Transport selection, protocol thresholds, pinning |
| 4. Collectives | `osu_allreduce`, `osu_alltoall`, `osu_barrier` | Routing distribution, jitter, one slow rank |
| 5. Application | The application | Nothing — it is what you were asked about |

Nothing here is novel. The value is entirely in refusing to skip.

## Layer 0: inventory before measurement

Half the MPI investigations that get escalated are version skew, and skew is
free to check before anything is measured. You want, across every node in the
allocation: the same OFED or DOCA-OFED release, the same adapter firmware, the
same MPI build, and PCIe slots that trained to their rated speed and width.

```bash
pdsh -w node[01-64] 'ofed_info -s; ibv_devinfo -d mlx5_0 | grep -E "fw_ver|board_id"' \
  | dshbak -c
```

`board_id` is the PSID, and it identifies the adapter model and OEM variant.
Two adapters with the same marketing name and different PSIDs are different
parts, take different firmware images, and do not necessarily behave alike.

Then the slot. This is the check people skip, and it is the one that most often
turns a two-week investigation into a two-minute one:

```bash
lspci -s $(cat /sys/class/infiniband/mlx5_0/device/uevent | grep PCI_SLOT_NAME | cut -d= -f2) -vv \
  | grep -E 'LnkCap:|LnkSta:'
```

```
LnkCap:	Port #0, Speed 32GT/s, Width x16, ASPM not supported
LnkSta:	Speed 16GT/s, Width x8, TrErr- Train- SlotClk+ DLActive+
```

That adapter is capable of PCIe Gen5 x16 and is running at Gen4 x8. Nothing will
report an error. The link will come up at its full InfiniBand rate. The host bus
will cap you at roughly a quarter of what the card can do, and every measurement
above this layer will be consistent, reproducible and wrong.

The arithmetic is worth internalising because it recurs across generations. A
PCIe Gen3 x16 slot delivers usefully under 13 GB/s after encoding and protocol
overhead, which is approximately one HDR100 link. Put an HDR200 adapter in one
and you have bought an HDR100 adapter. Gen4 x16 is roughly the right size for
HDR200 or NDR200. NDR400 wants Gen5 x16. XDR at 800 Gb/s is 100 GB/s in each
direction, which is more than a Gen5 x16 slot can carry, so on XDR hardware the
slot generation is not a footnote — check it explicitly and check what the
platform actually populated, not what the chassis datasheet says is possible.

## Layer 1: the link

Two questions only: is every port at the width and rate you paid for, and is any
port accumulating errors.

```bash
ibstat mlx5_0 1
```

```
Port 1:
	State:            Active
	Physical state:   LinkUp
	Rate:             200
	Base lid:         91
	LMC:              0
	SM lid:           1
	Link layer:       InfiniBand
```

`Rate: 200` here is the aggregate link rate in Gb/s. Note that for the same
link, `iblinkinfo` reports the **per-lane** rate and the width separately, and
conflating the two is a genuine and expensive misread:

```
  91    1[  ] ==( 4X  53.125 Gbps Active/  LinkUp)==>  12   9[  ] "leaf01" ( )
```

That is four lanes at 53.125 Gb/s each — an HDR200 link, not a 53 Gb/s link. On
NDR the same field reads `106.25 Gbps` and the link is NDR400. Someone reading
that column as the link rate concludes their NDR fabric is running at 100 Gb/s
and opens a support case.

The scan that matters is not any single port but the whole allocation at once,
looking for anything that is not at full width:

```bash
iblinkinfo -l | grep -vE '4X *(25\.78125|53\.125|106\.25|212\.5)' 
```

A port that negotiated `1X` or `2X` is Active, passes traffic, answers ping, and
runs your job at a fraction of the speed. It will not appear in any error log.

For physical link quality on modern adapters, `mlxlink` is more informative than
the counters:

```bash
mlxlink -d mlx5_0 -p 1 -m -c --show_fec --show_eye
```

It reports the negotiated speed, the FEC mode, raw and effective BER, and the
transceiver's vendor and part number. A link that is up but marginal shows as a
raw BER several orders of magnitude worse than its neighbours while the
effective BER stays clean, because FEC is absorbing it. That link works until
the day it is under load, and then it is a fabric-wide mystery.

Finally, clear the counters, run something, and read them back. Counters that
have been accumulating since the last power cycle tell you nothing about today:

```bash
ibclearerrors
# ... run a representative workload ...
ibqueryerrors -s PortXmitWait,PortRcvErrors,SymbolErrorCounter,LinkDownedCounter
```

`PortXmitWait` is not an error. It counts ticks where a port had data to send and
no credit to send it, which is congestion, and it belongs to layer four rather
than here. Note it and move on.

## Layer 2: verbs, without MPI in the picture

This is the layer people skip, and skipping it is why so many fabric problems
get diagnosed as MPI problems. `perftest` talks to the adapter directly. If
`ib_write_bw` is slow, no MPI tuning parameter is going to help you, and you
have just eliminated UCX, PMIx, Open MPI, process binding and the application in
one command.

```bash
# server
ib_write_bw -d mlx5_0 -i 1 -F -a --report_gbits
# client
ib_write_bw -d mlx5_0 -i 1 -F -a --report_gbits node02
```

`-F` suppresses the CPU-frequency warning on machines with a scaling governor,
`-a` sweeps all message sizes, `-i 1` selects the physical port. Add `-x <n>` to
select a GID index when you are on RoCE rather than InfiniBand.

Read the header before the numbers. It tells you the MTU that was negotiated,
the transport, and the connection type:

```
 Number of qps   : 1        Transport type : IB
 Connection type : RC       Using SRQ      : OFF
 Mtu             : 4096[B]
 Link type       : IB
```

An MTU of 1024 where you expected 4096 is a finding in itself, and on RoCE it
usually means the network MTU is not jumbo end to end.

Three runs, in this order, on the same pair:

- `ib_write_bw` — one-directional RDMA write. The cleanest bandwidth number the
  hardware can produce.
- `ib_read_bw` — RDMA read. Reads are round-trip and depend on how many
  outstanding reads the adapter allows, so this is normally lower than write and
  a good deal more sensitive to the fabric.
- `ib_send_lat -a` — send/receive latency across sizes. Sub-microsecond at small
  sizes on a single-hop modern fabric; each additional switch hop adds a
  well-defined increment you can measure directly by comparing an intra-leaf pair
  against a cross-spine pair.

What "good" is here is a property of your hardware, not something to assert from
an article. The check you can do without a reference number is arithmetic: take
the signalling rate from layer one, subtract the line encoding overhead, and see
whether `ib_write_bw` at large message sizes lands close to it. If it lands at
half, look at the width and the PCIe slot before looking anywhere else.

<div class="note" markdown="1">
Run layer two between several different node pairs, chosen deliberately: two
nodes on the same leaf, two nodes on different leaves, and the two nodes
furthest apart in the topology. One pair tells you almost nothing. Three pairs
chosen by topology tell you whether the problem is a node, a link, or the core
of the fabric.
</div>

## Layer 3: MPI point-to-point

Now, and only now, introduce MPI. If layer two was clean and layer three is not,
the problem is in the MPI stack, and that is a much smaller search space than
"somewhere in the cluster."

```bash
mpirun -np 2 -map-by ppr:1:node --bind-to core \
  -x UCX_NET_DEVICES=mlx5_0:1 \
  ./osu_latency
mpirun -np 2 -map-by ppr:1:node --bind-to core \
  -x UCX_NET_DEVICES=mlx5_0:1 \
  ./osu_bw
```

Compare `osu_bw` against the `ib_write_bw` number from the same pair. A gap of a
few percent is the MPI protocol overhead and is expected. A gap of a factor of
several means MPI is not using the transport you think it is, and the single
most common reason is a silent fall back to TCP over IPoIB.

`osu_bibw` runs traffic in both directions at once and is the test that finds
half-duplex-like behaviour and PCIe bottlenecks, because it is the first test
that asks the host bus for full bandwidth in both directions simultaneously. A
machine that does well on `osu_bw` and poorly on `osu_bibw` is usually telling
you about its slot, not its fabric.

`osu_mbw_mr` is the one that belongs at the end of this layer. It runs multiple
concurrent pairs and reports both aggregate bandwidth and message rate. It is
the bridge into layer four, and it is where a per-node ceiling that no
single-pair test can see becomes visible.

Pinning is not optional at this layer. An unpinned rank measures the scheduler.
Confirm the adapter's NUMA affinity and place accordingly:

```bash
cat /sys/class/infiniband/mlx5_0/device/numa_node
lstopo --output-format txt
mpirun --report-bindings -np 2 ...
```

`--report-bindings` prints where each rank actually landed. Read it. Do not
assume the binding you asked for is the binding you got, particularly under a
scheduler that has its own cgroup opinions.

## Layer 4: collectives

Collectives are where fabric problems that point-to-point cannot see finally
appear, because they are the first thing that puts many flows on the fabric at
once and the first thing that is gated by its slowest participant.

```bash
mpirun -np 512 -map-by ppr:8:node --bind-to core ./osu_alltoall
mpirun -np 512 -map-by ppr:8:node --bind-to core ./osu_allreduce
mpirun -np 512 -map-by ppr:8:node --bind-to core ./osu_barrier
```

A collective that degrades while layers one through three stayed clean is
telling you about routing distribution, congestion, or jitter — never about the
link. That distinction is the whole reason to have run the lower layers first.
Fan-out behaviour and how to read the knee in the scaling curve is a large
enough topic that it has its own article in this series.

## Layer 5: the application

By the time you get here you know the ceiling at every layer beneath, which
means an application number can finally be interpreted. If the application is at
sixty percent of what layer four delivers, that is an application question:
message sizes, communication/computation overlap, decomposition. If it is at
five percent, something below is still wrong and the earlier layers were not
tested carefully enough.

## What testing out of order actually costs

The failure mode is not that you fail to find the problem. It is that you find a
problem, and it is real, and it is not the one that is hurting you.

Start at the application, and its message sizes will look suboptimal, because
application message sizes usually are. You will spend a week on the
decomposition. The `1X` link stays there the whole time. Start at the
collectives, and you will conclude the routing engine is badly distributed,
which it may well be, and you will schedule a maintenance window to change it
while the downtrained PCIe slot continues to cap the node.

Both of those are true findings. Neither is the constraint. The ordering exists
because the only way to know whether a finding is the constraint is to know the
ceiling underneath it.

## Recording it

The output of this exercise is not a diagnosis, it is a baseline. Write down,
in version control, for a named node pair and a named node set: the OFED and
firmware versions, the PCIe link status, the `ib_write_bw` and `ib_read_bw`
plateaus, the `osu_latency` small-message number, and the collective curves at
the job sizes you actually run.

That file is what converts the next incident from an investigation into a diff.
It takes half a day to produce on a machine that is known good, and there is no
other moment when producing it is as cheap.
