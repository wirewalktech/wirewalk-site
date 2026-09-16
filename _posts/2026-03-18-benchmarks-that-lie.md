---
title: "Four ways a storage benchmark lies and how to catch each one"
date: 2026-03-18 10:00:00 -0400
category: Storage
tags: [Benchmarking, Measurement, fio, IOR, GPFS]
summary: >-
  A read test smaller than the server's buffer pool measures memory. An
  under-driven benchmark is indistinguishable from a ceiling. Counters are not
  rates, and aggregate CPU idle is meaningless on a many-core box. Here is the
  arithmetic that catches each one before you act on the number.
---

Storage benchmarks are unusually good at producing wrong answers that look
right. The number comes out, it is in the units you expected, it is in the
neighbourhood you hoped for, and nothing in the output says "this measurement
did not test what you think it tested". Then someone writes it in a capacity
plan, or opens a support case about it, or spends a maintenance window tuning a
subsystem that was never the constraint.

Four mechanisms account for most of it. Each has a specific arithmetic
signature, and each has a check that costs a few minutes and settles it.

The worked figures throughout are from one eight-server erasure-coded tier on
HDR200, and they are illustrative rather than a specification for anything: page
pool sizes, code widths and link rates all move the numbers. The arithmetic is
the part that transfers. Run it against your own configuration before quoting
any figure here.

## 1. The read you measured was served from memory

Most benchmarking guides tell you to use `O_DIRECT`. `fio --direct=1`,
IOR's `--posix.odirect`, `dd iflag=direct` for a read or `oflag=direct` for a
write. This is correct advice and it is routinely misunderstood, because
`O_DIRECT` is a flag on a file descriptor on one machine. It bypasses the page
cache on the client that opened the file. It has no authority whatsoever over
what the storage servers do with their own memory.

On a parallel filesystem the servers hold a large read buffer. For IBM Storage
Scale in its erasure-coded form, that buffer is a percentage of the daemon's
page pool, set by `nsdRAIDBufferPoolSizePct`. The documented default has been
50 percent historically and 80 percent in more recent releases, so read it
rather than assume it. The upper bound on the cache your `O_DIRECT` read is
still landing in is:

```
server-side buffer pool = pagepool × nsdRAIDBufferPoolSizePct × number of servers
```

That is an upper bound rather than a read cache exactly: the same pool holds
write and track buffers. It is still the right number to size a dataset
against, because it is the largest thing your read can hide in.

Check yours rather than assuming. Note that `mmlsconfig` tells you what is
stored and `mmfsadm dump config` tells you what is actually running, and these
are not always the same value. `mmfsadm` is a diagnostic tool that IBM
documents as being for use under service direction; `dump config` is read-only,
but treat the rest of the command surface as off-limits on a production
daemon:

```bash
mmlsconfig pagepool
mmlsconfig nsdRAIDBufferPoolSizePct
# and on one storage server, what is genuinely live:
mmfsadm dump config | grep -iE 'pagepool|nsdRAIDBufferPoolSizePct'
```

Take a tier of eight storage servers with a 37.7 GiB page pool each and the
buffer pool at 80 percent. That is 30.2 GiB per server and 241 GiB across the
tier. Any read test whose working set is comfortably below 241 GiB is measuring
DDR, not NVMe, no matter how many `O_DIRECT` flags are in the command line.

Here is what that looks like. Twelve clients, sixteen ranks each, 1 GiB per
rank — 192 GiB of data, which is 80 percent of the buffer pool:

```bash
mpirun -np 192 -N 16 ./ior \
  -a POSIX --posix.odirect -w -r \
  -b 1g -t 1m -F -e -C -i 1 \
  -o /gpfs/scratch/bench/ior.dat
```

```
access    bw(MiB/s)  IOPS       Latency(s)  block(KiB) xfer(KiB)  open(s)   wr/rd(s)  close(s)  total(s)
------    ---------  ----       ----------  ---------- ---------  --------  --------  --------  --------
write     68812      68812      0.002790    1048576    1024.00    0.021443  2.857     0.003120  2.882
read      159539     159539     0.001203    1048576    1024.00    0.004472  1.232     0.001196  1.238
```

159,539 MiB/s is 155.8 GiB/s. It is also nonsense. The `IOPS` column equals the
bandwidth figure here only because the transfer size is exactly 1 MiB — IOR
reports completed transfers per second, not GiB/s, and at `-t 4m` the two
columns would differ by four. Now the same test with `-b 16g` — 3 TiB, nearly
thirteen times the buffer pool:

```
access    bw(MiB/s)  IOPS       Latency(s)  block(KiB) xfer(KiB)  open(s)   wr/rd(s)  close(s)  total(s)
------    ---------  ----       ----------  ---------- ---------  --------  --------  --------  --------
write     68240      68240      0.002814    16777216   1024.00    0.019987  46.10     0.004011  46.13
read      83942      83942      0.002287    16777216   1024.00    0.003991  37.47     0.001330  37.48
```

Read falls from 155.8 to 82.0 GiB/s. The first figure was 1.9 times the cold
number. Write barely moves — 68,812 to 68,240 MiB/s, or 67.2 to 66.6 GiB/s —
which is the part that tells you the
mechanism rather than just the magnitude: writes were never being served out of
a read buffer, so they had nothing to lose.

Two tells you can spot without doing the arithmetic:

**The read phase finished in a second.** Any storage read phase that completes
in under roughly ten seconds has measured startup transients and cache. IOR
prints `total(s)` for exactly this reason. A 1.2 second read phase is not a
measurement, it is a rounding error with units.

**Read is more than twice write on hardware where it should not be.** Some
asymmetry is normal. A factor of 2.3 on a tier whose read and write paths use
the same NICs deserves an explanation before it gets published.

<div class="note" markdown="1">
Here the obvious interpretation is wrong in a way worth stating plainly. When
the number falls after you enlarge the dataset, the natural conclusion is "so it
was cache, and 82 is the truth". That conclusion is probably right, but two
points do not yet support it. Enlarging the dataset also lengthens the runtime,
changes which regions of the address space you touch, and may cross a storage
pool or fileset boundary with different placement. Any of those could depress
the number on its own.

The discriminator is more points along the same axis. Run at 2×, 4× and 8× the
buffer pool as well as the 12.7× above. A cache artefact produces a sharp fall
and then a flat floor — for instance 155.8 at 0.8×, then 82.4, 81.6, 82.3, 82.0
as the multiple climbs. A layout or locality effect produces a continuing slide.
If it keeps falling, you have found a second problem and you still do not know
the cold number.
</div>

There is no supported command that flushes the server-side pool on demand, so
sizing the dataset past it is the practical answer. On the clients,
`echo 3 > /proc/sys/vm/drop_caches` clears the Linux page cache but does not
touch the GPFS page pool, which is separate memory the daemon manages itself;
unmounting the filesystem on that client is what invalidates its cached buffers.

## 2. An under-driven benchmark is indistinguishable from a ceiling

This is the most expensive of the four, because it does not merely give you a
wrong number. It gives you a wrong number with a confident shape. You run at one
concurrency level, get 44 GiB/s, run again and get 44 GiB/s, add a node and get
44 GiB/s, and conclude you have found a hard wall. Everything about the result
says saturation. What you have actually found is that you did not ask for
enough work at once.

The arithmetic is Little's law. The number of I/Os that must be outstanding to
sustain a given bandwidth is:

```
outstanding = bandwidth ÷ I/O size × latency
```

At 82 GiB/s with 1 MiB transfers, that is 88.0 GB/s ÷ 1,048,576 B = about
84,000 IOPS. If per-I/O latency at the knee is 18 ms, you need roughly 1,510
requests in flight across the whole client set to get there. If your benchmark
has 384 outstanding, then at that latency you are arithmetically incapable of
reaching the number, and no amount of repeating the run will reveal that.

So sweep concurrency. Twelve clients, `iodepth=32`, varying `numjobs`:

```bash
for j in 1 2 4 8 16; do
  pdsh -w node[01-12] "fio --name=r --filename=/gpfs/scratch/bench/\$(hostname)/f \
    --rw=read --bs=1m --direct=1 --ioengine=libaio \
    --iodepth=32 --numjobs=$j --size=256g --runtime=60 --time_based \
    --group_reporting --output-format=json \
    --output=/gpfs/scratch/bench/\$(hostname)/sweep-$j.json"
done
```

Write each node's JSON to its own file rather than redirecting `pdsh` to one.
`pdsh` interleaves and line-prefixes the output of all twelve nodes, so a single
redirect gives you twelve mangled JSON documents in one file and `jq` will
refuse it. `--direct=1` is not optional here either: fio documents `libaio` as
only supporting queued behavior with non-buffered I/O, so on a buffered job it
degrades toward serialized submission and reintroduces exactly the
under-driving this sweep exists to detect.

`--size=256g` is chosen against problem 1, not at random. With `--time_based`
the 60-second run reads about 408 GiB from a 256 GiB file, so each node does
re-read its own data — but twelve nodes hold 3 TiB between them against a
241 GiB server pool, which keeps the hit rate low enough not to distort the
shape of the sweep. Shrink the file to something a single server could hold and
the whole curve lifts and flattens, and you will read the artefact as a ceiling.

| `numjobs` per node | Outstanding I/Os, all clients | Aggregate read (GiB/s) | Δ from previous |
|---|---|---|---|
| 1 | 384 | 44.0 | — |
| 2 | 768 | 68.1 | +55% |
| 4 | 1,536 | 81.5 | +20% |
| 8 | 3,072 | 82.0 | +0.6% |
| 16 | 6,144 | 81.7 | −0.4% |

The shape is the result, not any single row. It climbs steeply, the climb
decays, and then three consecutive points agree within one percent while
concurrency quadruples. That flat tail is what licenses the sentence "this tier
saturates at 82 GiB/s". Without it you have a lower bound and nothing more.

Cross-check the knee against Little's law. Here is the per-node fio output at
`numjobs=4`:

```
read: IOPS=6955, BW=6955MiB/s (7292MB/s)(408GiB/60001msec)
    slat (usec): min=12, max=1843, avg=41.28, stdev=22.17
    clat (msec): min=2, max=118, avg=17.94, stdev=9.61
     lat (msec): min=2, max=118, avg=17.98, stdev=9.61
```

128 outstanding per node divided by 17.98 ms is 7,120 IOPS. fio reports 6,955,
and twelve nodes at that rate is 81.5 GiB/s, the table's `numjobs=4` row. The
two agree to within about two and a half percent, which means the queue was
genuinely full and the latency figure is describing the same system the
bandwidth figure is. When those two disagree badly — Little's law predicting
double what fio reports, say — the queue was not full and one of the figures is
measuring something else.

There is a second sweep people skip, and it answers a different question. Sweep
node count at fixed per-node concurrency:

- If one node and twelve nodes each get the same rate, you found a **per-node**
  limit — a NIC, a PCIe link, a single-threaded path.
- If one node gets the whole budget and twelve nodes divide it, you found an
  **aggregate** limit — the servers, the disks, or the fabric between them.

These are different problems with different fixes, and a single-point
measurement cannot tell them apart.

### The fio trap that silently caps you at one

Setting `iodepth=64` with a synchronous I/O engine does nothing. `sync`, `psync`
and `pvsync` submit one request and wait for it; fio documents that `iodepth`
beyond 1 has no effect for them. A job file with `ioengine=psync` and
`iodepth=64` produces exactly the flat, confident, badly under-driven number
described above, and the command line looks like it asked for depth.

```bash
grep -E '^(ioengine|iodepth|numjobs)' bench.fio
# ioengine=psync      <-- iodepth below is inert
# iodepth=64
# numjobs=8
```

With a synchronous engine, `numjobs` is your only source of concurrency. With
`libaio` or `io_uring`, total outstanding is `numjobs × iodepth` per node.

## 3. A counter is not a rate

This is among the most common measurement errors in the field and it is entirely
mechanical. Almost every hardware and driver statistic is cumulative since boot,
since daemon start, or since the last reset. Reading it once and dividing by the
duration of your benchmark produces a number with the right units and no
meaning.

The tell is distinctive: the reported rate **falls as you run the test longer**,
because the numerator is fixed history and the denominator is your runtime. If
changing only `--runtime` changes your answer, you divided a counter by elapsed
time.

The fix is to sample twice and difference. InfiniBand port counters, using the
extended 64-bit set so they do not wrap mid-run:

```bash
lid=37; port=12; interval=30
a=$(perfquery -x $lid $port | awk -F: '/^PortXmitData/{gsub(/[^0-9]/,"",$2); print $2}')
sleep $interval
b=$(perfquery -x $lid $port | awk -F: '/^PortXmitData/{gsub(/[^0-9]/,"",$2); print $2}')
awk -v a="$a" -v b="$b" -v t="$interval" \
  'BEGIN{printf "%.2f GiB/s\n", (b-a)*4/t/1073741824}'
```

```
23.14 GiB/s
```

Two details in that snippet are easy to get wrong. `PortXmitData` is defined in
the InfiniBand architecture specification in units of four octets, so the delta
is multiplied by 4 to get bytes — the source of a great many capacity claims
that are exactly four times too low. And `-x` requests the extended
(`PortCountersExtended`) set; the basic counters are 32-bit, which at four
octets per unit is 17.2 GB of traffic before they wrap. On an HDR200 port
carrying 25 GB/s that is a wrap in well under a second, producing a negative
delta and, if your script does not check the sign, a negative or nonsensical
bandwidth. The snippet above does not check it either — add the guard before you
trust it unattended.

Resist the urge to reach for `perfquery`'s reset flags (`-r`, `-R`) first. On a
shared fabric you have just zeroed the inputs to somebody else's monitoring, and
the difference method does not need it.

The same discipline applies everywhere. NVMe wear counters, which carry a unit
almost nobody gets right on the first attempt:

```bash
nvme smart-log /dev/nvme0n1 | grep -iE 'data.units'
```

```
data_units_read                     : 4,283,915,042
data_units_written                  : 1,118,730,455
```

The `grep` pattern is deliberately loose because the field label changed:
older `nvme-cli` prints `data_units_read`, newer versions print
`Data Units Read`, and a pattern pinned to the underscore form silently returns
nothing on half the fleet.

A data unit here is a thousand 512-byte sectors — 512,000 bytes, not 512 and not
1 MiB. Assume 512 bytes and you are low by a factor of a thousand; assume 1 MiB
and you are high by a factor of 2.05. Sample twice, subtract, multiply by
512,000, divide by elapsed.

And the ordinary network counters in `/proc/net/dev` and `ethtool -S` are
cumulative too. `sar -n DEV 5` and `iostat -x 5` do the differencing for you,
which is precisely why the first sample they print — the one covering time since
boot — should always be discarded:

```bash
iostat -x 5 2 nvme0n1     # use the SECOND report, not the first
```

<div class="note" markdown="1">
Another place the obvious reading is wrong. `iostat` reports `%util`, and on a
spinning disk 100 percent `%util` meant the device was saturated. On NVMe it
means nothing of the kind. `%util` is the fraction of wall time during which at
least one request was in flight. An NVMe drive with 64 hardware queues can be at
100 percent `%util` while servicing one request at a time and running at three
percent of its capability.

The fields that actually carry information are `aqu-sz`, the average queue
depth, and `r_await`, the average service latency. `aqu-sz` is the sysstat 12
name; on sysstat 11 and earlier the same field is `avgqu-sz`, so a parser that
greps for one of them will come back empty on the other. A device with `%util=100`,
`aqu-sz=1.2` and `r_await=0.3` ms is nearly idle. The same device at
`aqu-sz=180` with `r_await` climbing run over run is the constraint. Judge NVMe
by queue depth and latency, never by `%util`.
</div>

## 4. Aggregate CPU idle proves nothing on a many-core machine

On a dual-socket server with 96 physical cores and SMT enabled — 192 logical
CPUs — one thread pinned at 100 percent contributes 100 ÷ 192 = 0.52 percent to
the aggregate. `top` reports 99.5 percent idle. Every dashboard is green. The
job is bottlenecked on a single saturated core and the summary statistic
physically cannot show it.

`mpstat` has the answer, provided you ask for per-CPU output and an interval.
Run without an interval and it prints averages since boot, which returns you to
problem 3.

```bash
LC_ALL=C mpstat -P ALL 5 1
```

```
14:03:16     CPU    %usr   %nice    %sys %iowait    %irq   %soft  %steal  %idle
14:03:16     all    0.41    0.00    0.22    0.09    0.00    0.51    0.00   98.77
14:03:16       0    0.20    0.00    0.20    0.00    0.00    0.00    0.00   99.60
14:03:16       1    0.40    0.00    0.20    0.00    0.00    0.00    0.00   99.40
14:03:16      37    0.20    0.00    2.61    0.00    0.00   96.99    0.00    0.20
```

`all` says 98.8 percent idle. CPU 37 says 99.8 percent busy, essentially all of
it in softirq — and note that CPU 37's 96.99 percent softirq shows up in the
`all` row as 96.99 ÷ 192 = 0.51, which is the whole of the aggregate `%soft`
column. The evidence is present in the summary; it is just divided by 192. Sort
for the busiest core rather than reading the summary:

```bash
LC_ALL=C mpstat -P ALL 5 1 | \
  awk '$2 ~ /^[0-9]+$/ {printf "cpu%-4s busy %5.1f%%\n", $2, $3+$4+$5+$7+$8}' | \
  sort -k3 -nr | head -5
```

```
cpu37   busy  99.8%
cpu112  busy  41.2%
cpu38   busy   3.1%
cpu4    busy   1.1%
cpu0    busy   0.4%
```

`LC_ALL=C` is load-bearing rather than decorative. In several locales sysstat
prints a 12-hour timestamp with a trailing `AM`/`PM`, which puts an extra field
at the front of every row and shifts `$3` onto `%usr`, `$4` onto `%nice` and so
on — the awk above then sums the wrong columns and reports a plausible, wrong
number. `S_TIME_FORMAT=ISO` achieves the same fixed layout if you would rather
keep the locale.

Summing `%usr + %nice + %sys + %irq + %soft` rather than `100 − %idle` keeps
`%iowait` out of the total. `%iowait` is not CPU work; it is idle time that
happened to coincide with a blocked task, and on a 192-core box it is diluted by
exactly the same factor that hides the busy core.

A single core at 96 percent softirq looks like receive-side packet processing
landing on one CPU. Confirm before acting:

```bash
grep -E 'mlx5|nvme' /proc/interrupts | awk '{print $1, $(NF)}' | head
awk 'NR==1 || /NET_RX/' /proc/softirqs | cut -c1-120
```

<div class="note" markdown="1">
Do not stop at "the interrupts are unbalanced, run irqbalance". Read the column,
not just the total. On an RDMA path the payload does not traverse the kernel
network stack, so `%soft` on a verbs benchmark is rarely `NET_RX` — it is more
often completion-queue work landing on the single CPU the queue pair's vector
was bound to, which `irqbalance` will not move because RDMA drivers pin their
own vectors. And if the hot column is `%sys` or `%usr` rather than `%soft`, the
busy core is not interrupt handling at all: it is a single-threaded submission
path, in the benchmark or in a filesystem daemon. Establish which before you
rebind anything:

```bash
top -H -p "$(pgrep -d, -f 'fio|mmfsd')" -b -n1 | head -20
```

If the hot thread belongs to your benchmark rather than to an interrupt, the
fix is more jobs, not IRQ affinity — and you are back at problem 2. Rebinding
interrupts to fix a problem that was never interrupts is how a tuning exercise
consumes a maintenance window and changes nothing.
</div>

## State the expected value before you measure

The four mechanisms above share one property: in every case the wrong number
looked plausible. That is what made it survive. The defense is to decide what
the number should be *before* you run anything, write the arithmetic down, and
treat agreement as weak evidence and disagreement as a finding.

Build the budget layer by layer, cheapest measurement first. For a tier of eight
storage servers on HDR200 serving twelve clients:

| Layer | Per unit | Count | Aggregate | How it was obtained |
|---|---|---|---|---|
| Server DDR read bandwidth | ~190 GiB/s | 8 | ~1.5 TiB/s | 8-channel DDR4-3200 per socket, arithmetic |
| NVMe random 128k read, per server | 62 GiB/s | 8 | 496 GiB/s | `fio` against raw devices, measured |
| HCA PCIe link (Gen4 ×16) | 29.3 GiB/s | 8 | 234 GiB/s | `current_link_speed` × `_width`, 128b/130b, arithmetic |
| Storage server NIC (HDR200, 200 Gb/s) | 23.3 GiB/s | 8 | 186 GiB/s | line rate, arithmetic |
| Inter-switch links, under load | 23.1 GiB/s | 8 | 185 GiB/s | `perfquery` delta, measured |
| Client NIC (HDR200) | 23.3 GiB/s | 12 | 280 GiB/s | line rate, arithmetic |
| Single client alone, all 12 idle | 22.9 GiB/s | 1 | — | `fio` on one node, measured |
| Erasure-code read amplification | ×1.88 | — | 99 GiB/s delivered | modeled from 8+2p, checked against `perfquery` |

The PCIe row is worth a caution, because it is the row most often quoted as a
measurement when it is nothing of the kind. `current_link_speed` and
`current_link_width` under `/sys/bus/pci/devices/` report what the link
negotiated, not what it carries: Gen4 ×16 at 16 GT/s with 128b/130b framing is
31.5 GB/s, or 29.3 GiB/s, and no adapter delivers that after TLP headers and
DMA overhead. Read it as a ceiling that is comfortably above the NIC line rate,
which is the only conclusion the row has to support here.

The binding constraint for a cold read is the storage-side NIC aggregate,
reduced by the read amplification of the erasure code. With `k` data strips
distributed one per node, delivering one byte to a client moves roughly
`1 + (k−1)/k` bytes on the storage fabric: the node fronting the client holds
`1/k` of the track locally, pulls the other `(k−1)/k` across the fabric from its
peers, and then sends the whole byte on to the client. For k = 8 that is 1.875.
186 ÷ 1.88 is 99 GiB/s of deliverable read bandwidth. The measured 82 GiB/s is
83 percent of that, which is a believable efficiency for a real filesystem and
is therefore not interesting.

This is a model, not a measurement, and it is the weakest row in the table. It
assumes full-track reads with no coalescing and no parity-strip traffic on a
healthy array, and it will be wrong under rebuild, wrong for partial-track
reads, and wrong for any layout that places more than one strip per node. Treat
it as the right order of magnitude for the correction rather than a constant,
and confirm it by comparing fabric bytes from `perfquery` against client bytes
from IOR on the same run.

The 155.8 GiB/s figure is 157 percent of that budget. It is not physically
impossible — it sits at 84 percent of the raw 186 GiB/s NIC aggregate — but it
can only be reached by removing a layer from the path, and the excess tells you
which layer. A buffer-pool hit serves the reconstructed logical track from the
server's own memory, so it skips both the NVMe read and the inter-node strip
gather, and the ×1.88 amplification disappears with them. The number went above
the budget because the budget's most expensive term stopped applying. Reading it
as "the storage is faster than we modeled" inverts the finding exactly.

That inversion is the whole discipline. A number that exceeds the budget is the
loudest alarm your benchmark can raise, and it is the one people are least likely
to investigate, because it is the number they wanted.

Two unit traps will move a figure enough to matter. One GB is 10⁹ bytes and one
GiB is 2³⁰; the gap is 7.37 percent, and one step down the scale the MiB-to-MB
gap is 4.86 percent. fio prints both — `BW=6955MiB/s (7292MB/s)` — and IOR
prints MiB/s only. Take fio's binary figure, relabel it with the decimal unit,
and you understate by 4.9 percent at the MiB level or 7.4 percent at the GiB
level: roughly the size of the improvements people schedule maintenance windows
for. And link rates are decimal: HDR200 is 200 × 10⁹ bit/s, which is 25.0 GB/s
and 23.3 GiB/s, not 25.

## Symptom against true cause

| Symptom | Tempting conclusion | Also consistent with | Check that distinguishes them |
|---|---|---|---|
| Read ≫ write on symmetric hardware | Read path is better optimized | Read served from the server buffer pool | Re-run at 2× and 4× the pool size; cache gives a sharp fall then a floor |
| Read phase finished in under 10 s | Fast storage | Working set fits in cache | `total(s)` in IOR; raise `-b` until the phase runs 60 s |
| Throughput flat across repeated runs | Saturation | Under-driven at a fixed, insufficient depth | Sweep `numjobs`; a real ceiling is flat while concurrency quadruples |
| Throughput flat as nodes are added | Aggregate ceiling | Per-node NIC or single-thread limit | Compare 1-node and N-node per-node rates |
| `iodepth` raised, nothing changed | Queue already full | Synchronous ioengine ignoring `iodepth` | `grep ioengine` in the job file |
| `%util` at 100 percent | Device saturated | One request in flight on a 64-queue device | `aqu-sz` and `r_await`, not `%util` |
| Rate falls as runtime rises | Thermal or cache-fill effect | Cumulative counter divided by elapsed | Sample the counter twice and difference |
| Bandwidth exactly 4× too low | Link running at 1X | `PortXmitData` read without the ×4 | Multiply the delta by 4; confirm width with `ibstatus` |
| CPU 98 percent idle under load | Not CPU-bound | One core at 100 percent out of 192 | `mpstat -P ALL`, sort by busiest core |
| Total rises as clients are added | Storage scales | You were client-limited the whole time | Per-node rate at 1 node versus N nodes |
| Second run much faster than the first | Warm-up effect | Second run read what the first run wrote | IOR `-C`, and drop client caches between phases |
| Bandwidth and latency both healthy, job still slow | Storage is fine | Metadata-bound, not bandwidth-bound | `mdtest` create/stat/remove rates |
| Array tool reports twice what `fio` reports | `fio` is misconfigured | Fabric counters include the strip gather | Compare the ratio against `1 + (k−1)/k` |
| Result matches the vendor datasheet | Configured correctly | Measured a cache, or copied the expectation | Compute the budget independently first |

## What to keep

Three habits close most of the gap.

Write the expected number down before the run, with the arithmetic that produced
it, in the same file as the result. This costs five minutes and converts every
benchmark from a measurement into a test with a pass condition.

Never report a single point. Report a sweep, and report the shape. "82 GiB/s"
is a claim; "82 GiB/s, flat within one percent from 1,536 to 6,144 outstanding
I/Os, at 3 TiB against a 241 GiB server buffer pool" is a result somebody else
can check.

And when the number comes out better than you expected, stop and find out why
before telling anyone. In the shape of problem described here, that is nearly
always the moment the measurement broke.
