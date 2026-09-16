---
title: "Reading Slurm accounting without fooling yourself about efficiency"
date: 2026-05-27 10:00:00 -0400
category: HPC
tags: [Slurm, Accounting, Efficiency, Reporting, Capacity]
summary: >-
  How to compute CPU and memory efficiency from Slurm's accounting database so
  the number survives a sceptical reader, which two field choices produce
  confidently wrong answers that nobody catches, and why a low fleet figure is
  almost always a request-shape problem rather than a user-behavior problem.
---

Someone asks how well the cluster is being used. It is a reasonable question and there is a
database full of the answer, so you write a query. Twenty minutes later you have a number, and
the number is wrong in a way that will not announce itself. Both of the common mistakes produce
output that looks like a measurement: one gives you a beautiful figure, one gives you an alarming
figure, and neither has anything to do with how busy the cores were.

This is about getting a defensible number out of `sacct`, knowing which fields lie to you, and
knowing what the number means once you have it — because the usual interpretation of a low
efficiency figure is also wrong.

## What CPU efficiency actually is

CPU efficiency is consumed CPU time divided by allocated CPU time:

```
efficiency = TotalCPU / (NCPUS * Elapsed)
```

The denominator is what the scheduler took off the table. If a job holds eight cores for four
hours, nobody else can have those eight cores for those four hours, whether the job uses them or
not. The numerator is what the job's processes actually burned, user time plus system time, as
measured by the accounting plugin.

That is exactly what `seff` computes. From the shipped Perl (`contribs/seff/seff.pl`):

```perl
my $corewalltime = $walltime * $ncpus;
if ($corewalltime != 0) {
    $cpu_eff = $cput / $corewalltime * 100;
}
```

So for a single job you can just run `seff` and stop reading:

```
$ seff 918442
Job ID: 918442
Cluster: (redacted)
User/Group: user01/user01
State: COMPLETED (exit code 0)
Nodes: 1
Cores per node: 8
CPU Utilized: 04:14:07
CPU Efficiency: 12.55% of 1-09:44:40 core-walltime
Job Wall-clock time: 04:13:05
Memory Utilized: 5.47 GB
Memory Efficiency: 8.55% of 64.00 GB
```

`seff` does not scale. It is one job per invocation and it goes through the Slurm Perl API each
time. For a fleet report over a month of jobs you need `sacct`, and that is where the trouble
starts.

## Trap one: CPUTimeRAW is allocation, not consumption

`sacct` offers a field called `CPUTimeRAW`. The name reads like "the raw CPU time this job used".
It is not. The manual is unambiguous:

> **CPUTimeRAW** — Time used (Elapsed time * CPU count) by a job or step in cpu-seconds.

That is the denominator. `CPUTime` is the same quantity in `HH:MM:SS`. It is allocated core-time,
computed arithmetically from the allocation, and it has no idea whether the cores were doing
anything. You can verify this in one line — the identity holds exactly, not approximately:

```bash
$ sacct -j 918442 -X -o JobID,NCPUS,ElapsedRaw,CPUTimeRAW --parsable2 --noheader
918442|8|15185|121480

$ python3 -c "print(8*15185)"
121480
```

The failure mode is that someone builds the ratio out of the field whose name sounded right:

```bash
# WRONG — this is the definition of 1.0
sacct -a -S 2026-04-01 -E 2026-05-01 -X --parsable2 --noheader \
      -o CPUTimeRAW,NCPUS,ElapsedRaw \
  | awk -F'|' '{u+=$1; a+=$2*$3} END {printf "efficiency %.1f%%\n", 100*u/a}'
```

```
efficiency 100.0%
```

It is not 100.0% because the cluster is perfectly used. It is 100.0% because you divided a
quantity by itself. Every job contributes exactly its own allocation to both sides, so the answer
is identically one for any job mix, any time window, any partition. The number is not even
slightly sensitive to reality: drain half the nodes, let jobs idle for days, and it still reads
100.0%.

The reason this survives review is that 100% is not obviously absurd to a non-specialist. On a
busy cluster with a deep queue, "we are at 100%" reads as a statement about the queue rather than
about the cores. It gets into a slide. The give-away is that it is *exactly* 100.0% and stays
exactly 100.0% when you change the window — a real measurement never does that.

## Trap two: the allocation-only flag zeroes the numerator

The other field you need is `TotalCPU`:

> **TotalCPU** — The sum of the SystemCPU and UserCPU time used by the job or job step.

That is the right numerator. But CPU time is gathered per *step*, not per allocation. A batch job
produces several accounting records: the job allocation record (`918442`), the batch step
(`918442.batch`), the external step (`918442.extern`) that holds anything adopted into the job's
cgroup, and one record per `srun` (`918442.0`, `918442.1` …). The `-X` / `--allocations` flag says:

> Only show statistics relevant to the job allocation itself, not taking steps into consideration.

Which means the step records are not fetched at all, and the step-derived accounting fields are
not populated from them. Everyone knows this about `MaxRSS`, because a blank column is visible.
Rather fewer people notice it about `TotalCPU`, because it comes back as a plausible-looking time
string rather than a blank:

```bash
$ sacct -j 918442 -X -o JobID,NCPUS,ElapsedRaw,TotalCPU
JobID          NCPUS ElapsedRaw   TotalCPU
------------ ------- ---------- ----------
918442             8      15185   00:00:00
```

```bash
$ sacct -j 918442 -o JobID,NCPUS,ElapsedRaw,TotalCPU
JobID          NCPUS ElapsedRaw   TotalCPU
------------ ------- ---------- ----------
918442             8      15185  04:14:07
918442.batch       8      15185  04:14:07
918442.extern      8      15185   00:00.001
```

Same job, same database, two different answers, and the difference is one flag. The job row's
`04:14:07` in the second listing is assembled from the step rows that the same query returned;
with `-X` there are no step rows to assemble it from. Build a fleet report on the first form and
every ratio is `0 / something`, so the cluster reads 0.0% efficient.

That ought to be caught — and usually is, if the whole report is built that way. It is *not*
caught when the query includes steps for some jobs and not others, or when someone filters the
zeroes out as "bad records" before averaging. Drop the zero rows and you are left with exactly
the jobs that ran many `srun` steps, which are the well-parallelized ones, and your cluster
suddenly reports 70%.

Whether the job-level record carries a rolled-up `TotalCPU` depends on your Slurm version, on
whether the query pulled the steps, and on how the job was launched, so do not take my word for
it. Check on your own installation before you trust any script (this quick check splits on `:`
only, so run it on a job under a day of CPU time; the `tosec()` function further down handles the
`DD-` form):

```bash
sacct -j 918442 --parsable2 --noheader -o JobID,TotalCPU \
  | awk -F'|' '{ n=split($2,p,":"); s=(n==3)?p[1]*3600+p[2]*60+p[3]:p[1]*60+p[2];
                 if ($1 ~ /\./) step+=s; else job=s }
               END {printf "job row: %.1fs   sum of steps: %.1fs\n", job, step}'
```

```
job row: 15247.0s   sum of steps: 15247.0s
```

If those two agree on your cluster, either source is fine. If the job row is zero, you must sum
the steps. Write the script so it works either way and you never have to care.

## Trap three: the one that produces a believable number

The first two traps produce 100.0% and 0.0%. Those are at least suspicious. The trap that
actually ships is the averaging.

There are two things you might mean by "cluster efficiency", and they are not close to each
other:

- **Job-mean**: compute efficiency per job, then take the arithmetic mean over jobs.
- **Core-weighted**: sum consumed CPU-seconds over the whole fleet, sum allocated CPU-seconds over
  the whole fleet, divide once.

Take a constructed month with two populations, chosen to make the arithmetic visible:

| population | count | cores | elapsed | per-job eff | allocated core-h | consumed core-h |
|---|---|---|---|---|---|---|
| array tasks | 12,000 | 1 | 5 min | 95% | 1,000 | 950 |
| wide jobs | 180 | 128 | 12 h | 18% | 276,480 | 49,766 |

Job-mean: `(12000 × 0.95 + 180 × 0.18) / 12180 = 93.9%`.

Core-weighted: `(950 + 49,766) / (1,000 + 276,480) = 18.3%`.

Same data. 93.9% or 18.3%, depending on a choice most people do not realize they are making. The
job-mean is dominated by twelve thousand five-minute array tasks that together account for 0.4%
of the machine. The core-weighted figure is the one that answers "how much of the cluster's
capacity turned into computation", which is the question that was asked.

Use core-weighted for any capacity or spend conversation. Job-mean is useful for exactly one
thing: finding which *users* have a habit of over-requesting, where you want each job to count
once regardless of size. Label whichever you publish.

## The working query

Query without `-X`, take the denominator from the job row and the numerator from the step rows,
and parse the time formats properly. `TotalCPU` is printed as `[DD-[HH:]]MM:SS[.mmm]`, so you will
see `00:00.001` and `2-03:14:22` in the same column; a naive `HH:MM:SS` split gets both wrong.

```bash
sacct -a -S 2026-04-01T00:00:00 -E 2026-04-30T23:59:59 \
      --parsable2 --noheader --delimiter='|' \
      --format=JobID,User,Account,Partition,State,NCPUS,ElapsedRaw,CPUTimeRAW,TotalCPU,ReqMem,MaxRSS,NNodes \
  > /tmp/acct-apr.psv
wc -l /tmp/acct-apr.psv
```

```
2841577 /tmp/acct-apr.psv
```

Two and a half million rows is a few hundred megabytes of text, so put it somewhere with room —
filling the root filesystem of a login or head node is an unpleasant way to learn that a month of
accounting is bigger than it looks.

Then aggregate:

```awk
#!/usr/bin/awk -f
# slurm-eff.awk — core-weighted CPU efficiency by partition
BEGIN { FS = "|" }

function tosec(t,   d, p, n, s) {
    d = 0
    if (t ~ /-/) { split(t, p, "-"); d = p[1] + 0; t = p[2] }
    n = split(t, p, ":")
    if      (n == 3) s = p[1]*3600 + p[2]*60 + p[3]
    else if (n == 2) s = p[1]*60 + p[2]
    else             s = p[1] + 0
    return d*86400 + s
}

$1 ~ /\./ {                       # step record: the numerator lives here
    split($1, a, ".")
    consumed[a[1]] += tosec($9)
    next
}
{                                 # job record: the denominator lives here
    if ($5 !~ /^(COMPLETED|FAILED|TIMEOUT|OUT_OF_MEMORY|NODE_FAIL)/) next
    if ($7 + 0 < 120) next        # sub-2-minute jobs are startup, not work
    alloc[$1] = $8 + 0            # CPUTimeRAW == NCPUS * ElapsedRaw
    part[$1]  = $4
}
END {
    for (j in alloc) {
        A[part[j]] += alloc[j]
        C[part[j]] += consumed[j]
        TA += alloc[j]; TC += consumed[j]
    }
    printf "%-12s %14s %14s %8s\n", "partition", "alloc_core_h", "used_core_h", "eff"
    for (p in A)
        printf "%-12s %14.1f %14.1f %7.1f%%\n", p, A[p]/3600, C[p]/3600, 100*C[p]/A[p]
    printf "%-12s %14.1f %14.1f %7.1f%%\n", "TOTAL", TA/3600, TC/3600, 100*TC/TA
}
```

```bash
$ awk -f slurm-eff.awk /tmp/acct-apr.psv
```

Illustrative output — these figures are constructed to show the shape of the result, not a
measurement of any particular machine. `for (p in A)` iterates in an unspecified order, so the
partition block comes out shuffled; sort it yourself if the order matters, but do not pipe the
whole output through `sort` or the header and the `TOTAL` line get sorted along with the data:

```
partition      alloc_core_h    used_core_h      eff
normal             276480.4        50716.3    18.3%
long               188411.2        61533.9    32.7%
gpu                 41203.6         9877.1    24.0%
short                1000.2          950.1    95.0%
TOTAL              507095.4       123077.4    24.3%
```

Three details in that script are load-bearing.

The state filter excludes `RUNNING` and `PENDING`. A running job has a growing denominator and a
numerator that is only as fresh as the last accounting poll, so it drags the average down for no
reason. `CANCELLED` is excluded too, though that one is a judgment call: a job canceled at 90%
of its walltime really did consume the allocation, and if your users cancel a lot you should
count it. Say which you did.

The 120-second floor removes the long tail of jobs that failed at startup. On a cluster with heavy
array use these can be the majority of records by count and a rounding error by core-hours, so the
floor barely moves the core-weighted number — but it removes thousands of 0% rows that would wreck
a job-mean.

The step loop sums *all* step records including `.extern`. That is deliberate, and it is the next
trap.

## Where the obvious reading is wrong: extern and SSH-launched ranks

The tidy instinct is to drop `.extern` from the numerator. It is the container step for the job's
cgroup, it normally shows a millisecond or two of CPU, and it feels like noise.

On a site running `pam_slurm_adopt`, it is not always noise. The thing to understand is that
"`mpirun` instead of `srun`" is not by itself the problem — the question is whether the launcher
bootstraps through Slurm or through SSH. Open MPI's `mpirun`, inside an allocation, uses `srun` to
start its daemons, so a step record does exist. Intel MPI exported with
`I_MPI_HYDRA_BOOTSTRAP=ssh`, Open MPI forced onto the `rsh`/`ssh` launcher or built without Slurm
support, and hand-rolled `ssh`-in-a-loop launchers all start the remote processes over SSH, and
none of those produce a `918442.0` on the remote nodes.

What there is on those nodes, if adoption is configured, is the external step — `pam_slurm_adopt`
puts the incoming SSH session into the job's extern cgroup, and the adopted processes' CPU time is
then accounted against `.extern` rather than against any launch step.

Drop `.extern` and every one of those jobs reports roughly `1/N` efficiency, where N is the node
count, because you counted only the rank on the batch node. A 16-node job that is running
perfectly reads 6%. That is a very convincing-looking finding. It is also completely false, and it
points the investigation at the users who are doing the most demanding work.

The check takes one run:

```bash
$ awk -f slurm-eff.awk /tmp/acct-apr.psv | tail -1
TOTAL              507095.4       123077.4    24.3%

$ grep -v '\.extern|' /tmp/acct-apr.psv | awk -f slurm-eff.awk | tail -1
TOTAL              507095.4        94112.8    18.6%
```

A gap that size between the two runs tells you a meaningful fraction of your CPU time is being
recorded against the external step, which tells you that work is arriving on compute nodes by some
route other than a Slurm launch step. That is worth knowing on its own. If the two runs agree to
within a percent, `.extern` genuinely is noise on your cluster and either choice is fine.

There is a worse version of this. If adoption is *not* configured, the remote ranks belong to no
step and no cgroup, and their CPU time is not recorded anywhere at all. No amount of careful
querying recovers it. The symptom is an MPI-heavy partition that reports implausibly low
efficiency while the nodes are visibly hot; confirm by watching `ps` on a compute node during one
of those jobs, or by comparing `sacct` against a node-level metric such as a CPU-utilization
exporter. If that is your situation, the accounting database cannot answer the efficiency question
for those jobs and you should say so rather than publish the number.

## The memory half

CPU efficiency alone will mislead you about waste. On most general-purpose clusters memory is the
binding constraint more often than cores, and a job that holds a node's entire RAM while using
6 GB of it is wasting the machine even at 100% CPU.

The fields:

```bash
$ sacct -j 918442 -o JobID,ReqMem,MaxRSS,MaxRSSNode,MaxRSSTask,TRESUsageInTot%40 --units=G
JobID          ReqMem     MaxRSS MaxRSSNode MaxRSSTask                        TRESUsageInTot
------------ -------- ---------- ---------- ---------- -------------------------------------
918442            64G
918442.batch            5.47G      nodeA             0   cpu=04:14:07,energy=0,fs/disk=12.1G,
                                                          mem=5.47G,pages=0,vmem=6.02G
918442.extern              0       nodeA             0   cpu=00:00:00,mem=0,pages=0,vmem=0
```

(The `TRESUsageInTot` column is wrapped here to fit the page; `sacct` truncates it to the width
you asked for instead. Exact unit rendering — trailing zeroes, which fields `--units` reaches —
moves about between versions, so match your own output rather than this one.)

Two things to fix in your head.

**`ReqMem` changed meaning in 21.08.** The release notes are explicit: it now "shows the requested
memory of the whole job with a letter appended indicating units", and it is only displayed for the
job record, not the steps. Before that it carried a `Mn` / `Mc` suffix meaning per-node or
per-core, and you had to multiply by node count or core count yourself to get the job total. A
script written against the old format and run against a new cluster — or the reverse — is wrong by
a factor equal to the core count, which on a 128-core node is not subtle. Check your version
before you write the parser:

```bash
$ sacct -V
slurm 24.05.7
```

**`MaxRSS` is a maximum over tasks, not a sum.** The existence of `MaxRSSTask` and `MaxRSSNode`
tells you this directly: they name *which* task and *which* node hit the peak. For a single-task
job, `MaxRSS` is the job's memory. For a 128-rank MPI job where every rank uses 3 GB, `MaxRSS`
reports 3 GB while the job actually held 384 GB. Divide that by `ReqMem` and you will conclude the
job over-requested by a factor of 128 and go and tell the user so.

The field to reach for instead is `mem=` inside `TRESUsageInTot`, which the manual defines as
"Tres total usage in by all tasks in job" — the per-task peaks added up. Note what that is and is
not: because the peaks need not have happened at the same moment, the sum is an upper bound on
what the job held simultaneously, not a measurement of it. It is still much closer to the truth
than `MaxRSS` for a multi-task job.

Do not assume `seff` settles this for you. `seff` does not read `tres_usage_in_tot` at all: it
takes the per-task maximum from `tres_usage_in_max`, keeps the largest one across the steps, and
multiplies by that step's task count. On a job whose ranks are all doing the same thing that is a
fair estimate; on one where a single rank holds most of the memory it can be far out in either
direction. `seff` is honest about this — for a multi-task step it labels the line
"(estimated maximum)". So `seff`'s "Memory Utilized", a `MaxRSS` query and a `TRESUsageInTot`
query can produce three different numbers for the same job, and none of them is a true
simultaneous job-wide peak, because Slurm does not record one.

One more limit worth stating plainly: memory accounting is, historically, sampled.
`JobAcctGatherFrequency` defaults to 30 seconds for the task datatype, and a job that allocates
200 GB for four seconds and frees it can poll clean and show a `MaxRSS` of 8 GB.

The `cgroup/v2` plugin improves on that by taking `MaxRSS` from the kernel's `memory.peak`, which
is a high-water mark rather than a sample. Two things then follow, and they pull in opposite
directions. First, filesystem-backed memory counts: the page cache a job generates by reading and
writing files is included in the reported RSS unless you set `JobAcctGatherParams=no_file_cache`,
so an I/O-heavy job can look memory-hungry when it is not. Second, the manual is explicit that
`no_file_cache` "disables the use of the `memory.peak` interface, which can result in `MaxRSS`
failing to record short memory spikes" — the cleaner number costs you the high-water mark. Slurm
24.11 also lists a fix for jobs that run shorter than two gather intervals, which previously could
report nothing at all.

So there is no single answer to "is my `MaxRSS` trustworthy": it depends on your
`JobAcctGatherType`, your cgroup version, your `JobAcctGatherParams` and your Slurm version. Check
which path your cluster is on before you tell users to cut their memory requests, and leave
headroom either way. A job killed by the OOM handler costs more than the memory it was holding.

## Array jobs

Arrays need care for three separate reasons.

```bash
$ sacct -j 918500 -X -o JobID,JobIDRaw,State,NCPUS,ElapsedRaw
JobID            JobIDRaw      State   NCPUS ElapsedRaw
--------------- ---------- ---------- ------- ----------
918500_[4-500]      918500    PENDING       1          0
918500_1            918501  COMPLETED       1        363
918500_2            918502  COMPLETED       1        358
918500_3            918503  COMPLETED       1        371
```

First, the pending master record `918500_[4-500]` is a real row with a real `JobID`. It has zero
elapsed time so it contributes nothing to a core-weighted sum, but it is one row out of many in a
job-mean, and if you are counting jobs it inflates your count by one per array rather than one per
task. Filter on state.

Second, `JobID` and `JobIDRaw` differ for array tasks. Step records are keyed on the `JobID` form
(`918500_2.batch`), so join on `JobID`, not `JobIDRaw`. Mixing the two silently drops the
numerator for every array task. The raw ids are handed out as tasks are scheduled, so do not
assume they are contiguous, ordered, or related to the task index in any useful way.

Third, and most important: arrays are how one user generates a hundred thousand accounting rows.
Any per-job average is now a report on that one user's array. This is the single biggest reason
to publish the core-weighted figure.

## The traps, and the answer each one produces

| Trap | Wrong answer it produces | How to spot it |
|---|---|---|
| `CPUTimeRAW` used as consumed CPU | Exactly 100.0%, always | Figure does not move when you change the window |
| `-X` with `TotalCPU`, where the job row is not rolled up | Exactly 0.0% | `TotalCPU` column reads `00:00:00` for every job |
| Zero rows filtered out as "bad data" after using `-X` | 60–80%, entirely fictional | Row count after filter is a small fraction of jobs |
| Summing `TotalCPU` over job *and* step rows | Roughly double; some jobs >100% | Any per-job efficiency above 100% |
| Step `NCPUS` used in the denominator | Inflated; varies by launch style | Denominator smaller than `CPUTimeRAW` on the job row |
| Mean of per-job ratios | 90%+ on an array-heavy cluster | Job count in the thousands, core-hours dominated by tens of jobs |
| `.extern` dropped where `pam_slurm_adopt` adopts SSH-launched ranks | MPI partitions read at `1/N` | Re-run including `.extern` and compare |
| No adoption configured, ranks launched over SSH | Unrecoverable under-count | `sacct` disagrees with node-level CPU metrics |
| `RUNNING` jobs included | Understated, drifts by time of day | Efficiency changes when you re-run the same window |
| Jobs straddling the window counted whole | Monthly totals exceed the machine's capacity | Sum of months ≠ the year |
| `-T` used to fix that | Some jobs above 100% | Truncates elapsed, does not prorate `TotalCPU` |
| `MaxRSS` used as job memory | Understated by the task count | Multi-node jobs all read ~1% memory efficiency |
| `seff` memory quoted as measured | An estimate: per-task max × task count | `seff` prints "(estimated maximum)" on multi-task steps |
| `ReqMem` parsed without checking version | Off by core count or node count | Memory efficiency above 100% or absurdly below |
| SMT threads counted as cores | Hard ceiling at 50% | No job in the fleet exceeds 50% |
| `sacct` efficiency compared to `sreport` "Used" | The two never agree | They are different quantities — see below |

On that last row: `sreport`'s usage columns are built from what jobs were *charged*, which is
allocation-derived — the same family of quantity as the usage that feeds fairshare, though
fairshare additionally applies `TRESBillingWeights` and a decay half-life, so the two are not
interchangeable either. What matters here is that none of it is `TotalCPU`. So `sreport` and
a correct `sacct` efficiency query are not meant to agree, and the ratio between them is roughly
your efficiency figure. You can confirm the relationship on your own cluster by checking that
`sreport` totals track your summed `CPUTimeRAW` rather than your summed `TotalCPU` — if they do,
the model above is right for your version.

## Field reference

| Field | What it is | Which record carries it | Gotcha |
|---|---|---|---|
| `NCPUS` / `AllocCPUS` | Allocated CPU count | Job and step | Step value can be smaller than the job's |
| `ElapsedRaw` | Wall seconds | Job and step | Step elapsed ≠ job elapsed |
| `CPUTimeRAW` | `NCPUS × ElapsedRaw` | Job and step | Allocation, never consumption |
| `TotalCPU` | `UserCPU + SystemCPU` | Step; job row varies by version | Format is `[DD-[HH:]]MM:SS[.mmm]` |
| `UserCPU` / `SystemCPU` | The two halves | Step | High system time can mask an idle job |
| `ReqMem` | Requested memory | Job only, since 21.08 | Per-node/per-core suffix before 21.08 |
| `MaxRSS` | Peak RSS of the largest single task | Step | Not a sum across tasks |
| `MaxRSSTask` / `MaxRSSNode` | Which task and node peaked | Step | Their existence proves `MaxRSS` is a max |
| `TRESUsageInTot` | Per-TRES totals, `mem=` summed over tasks | Step | Sum of per-task peaks: an upper bound, not a simultaneous peak |
| `TRESUsageInMax` | Per-TRES per-task maxima | Step | The `MaxRSS` number, in TRES form; what `seff` reads |
| `AllocTRES` | Full allocation including GRES | Job | Where GPU counts live |
| `State` | Final state | Job and step | Filter before aggregating |
| `NNodes` / `NTasks` | Shape of the job | Job / step | `NTasks` blank on the job record |
| `JobID` / `JobIDRaw` | Array-form and underlying id | Both | Join on `JobID` |

## Worked example

Back to job 918442. Eight cores, 15,185 seconds elapsed, so 121,480 allocated core-seconds. The
steps sum to 15,247 seconds of CPU.

```
efficiency = 15247 / 121480 = 12.55%
cores used = 15247 / 15185 = 1.004
allocated  = 8
memory     = 5.47 GiB of 64 GiB requested = 8.55%
waste      = (121480 - 15247) / 3600 = 29.5 core-hours parked
```

The percentage is the least useful line there. "1.004 cores out of 8" tells you what happened:
this is a single-threaded program that asked for eight cores. It is not a program that is 12.55%
efficient at using eight cores — it is a program that is 100% efficient at using one core and was
given eight. Nothing the user can do to their code will move the 12.55%. Changing `--cpus-per-task`
from 8 to 1 moves it to roughly 100%, instantly, and on this job — one thread, 5.47 GiB of a
64 GiB request — with no change to runtime. Check the memory before you send that advice, though:
where the site sets `DefMemPerCPU`, cutting the core count cuts the job's memory with it, and the
user who was quietly using cores as a memory allocation will get an OOM kill for following your
guidance. That is the second of the three rational reasons below, and it is a site configuration
problem, not a user problem.

That reframing is the whole point. Report **average cores used against cores allocated**, not a
percentage, and the diagnosis falls out of the number:

| Cores used vs allocated | Reading | What to do |
|---|---|---|
| ~1.0 of N, N > 1 | Single-threaded job over-requesting | Fix the submission script |
| ~N of N | Working as intended | Nothing |
| ~0.5N of N | One thread per SMT core, or half the ranks idle | Check `ThreadsPerCore` before blaming the user |
| ≪1.0 of N | I/O-bound, or waiting on a license or a lock | Look at `SystemCPU` and at the filesystem |
| > N | Oversubscribed, or no cgroup pinning | Check `TaskPlugin` and the thread-library env |
| ~N early, ~1 late | Serial post-processing tail | Split the job; the average hides it |

The SMT row is worth dwelling on. Depending on `SelectTypeParameters` and the node's
`ThreadsPerCore`, allocating one core can charge you two CPUs, in which case a perfectly
saturating single-threaded task caps out at 50% and no job on the machine will ever read higher.
Before concluding your users waste half the cluster, check:

```bash
$ scontrol show node nodeA | grep -E 'CPUAlloc|CPUTot|ThreadsPerCore|Boards'
   CPUAlloc=128 CPUEfctv=128 CPUTot=128
   Boards=1 SocketsPerBoard=2 CoresPerSocket=64 ThreadsPerCore=1
```

`ThreadsPerCore=1` there, so it is not the explanation on that node. If it reads 2, every
efficiency figure you have is measured against threads.

## What a realistic fleet number looks like

I am not aware of a systematic published survey of core-weighted CPU efficiency across academic
clusters, so treat any single quoted figure — including mine — as a prior rather than a
benchmark. The working range I would expect on a general-purpose, mixed-workload cluster is
roughly 35% to 65%. A number in the high thirties on a machine that serves a lot of bioinformatics
and statistics is unremarkable. Below about 25% something structural is usually going on: a
partition configured exclusive so every job charges a whole node, a default `--cpus-per-task`
that does not match the default thread count of the dominant application, or GPU jobs whose CPU
allocation is incidental.

Two caveats on the number itself.

GPU partitions should not be assessed on CPU efficiency at all. A job holding four GPUs and eight
cores to feed them is doing exactly the right thing and will read 10%. You need GPU utilization
from a device-level exporter; the accounting database records that GPUs were allocated, not that
they were busy.

And the honest reading of a low figure is almost never "users are wasteful". Sort the parked
core-hours by cause and, on the mixed-workload clusters I have looked at, most of them come from
single-threaded jobs asking for several cores. Users do this for three rational
reasons: they were told to by a tutorial written for a different scheduler, they are using cores
as a proxy for memory because the site's memory-per-core default is low, or the application is
genuinely threaded but only for one phase of its run. The first is a documentation fix, the second
is a scheduler configuration fix, and only the third is really the user's problem.

So publish two columns, not one. Core-hours parked, and the count of jobs where cores-used is
below 1.5 while cores-allocated is above 2. The first is the size of the prize. The second is the
list of submission scripts to go and fix, and it is usually short — a handful of templates that
have been copied across a department.

This one needs the same `tosec()` as before. `awk` accepts `-f` more than once, so keep that
function in a file of its own and prepend it rather than pasting it twice — an inline program that
calls `tosec()` without it is a fatal "calling undefined function", not a silent zero.

```awk
# parked.awk — worst over-requesting jobs by parked core-hours
BEGIN { FS = "|" }
$1 ~ /\./ { split($1, a, "."); c[a[1]] += tosec($9); next }
$5 == "COMPLETED" && $7 + 0 > 600 { n[$1] = $6; e[$1] = $7; u[$1] = $2 }
END {
    for (j in n)
        if (n[j] > 2 && c[j]/e[j] < 1.5)
            printf "%-12s %-10s %3d cores  %.2f used  %8.1f core-h parked\n",
                   j, u[j], n[j], c[j]/e[j], (n[j]*e[j] - c[j])/3600
}
```

```bash
$ awk -f tosec.awk -f parked.awk /tmp/acct-apr.psv | sort -k7 -gr | head -20
```

Run that, and instead of a percentage you have twenty lines, each naming a submission script and
the number of core-hours it costs per month. That is a conversation you can actually have.
