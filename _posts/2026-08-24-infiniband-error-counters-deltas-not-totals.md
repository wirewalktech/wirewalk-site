---
title: "InfiniBand error counters: read deltas, not totals"
category: Fabric
tags: ["InfiniBand", "perfquery", "Error Counters", "Symbol Errors", "Cabling", "Validation", "RDMA"]
summary: >-
  Port counters are cumulative since the last reset, so a large number may be
  five years of history and a small one may be happening right now. Only a
  delta over a known window tells you whether a link is degrading.
description: "How to read InfiniBand port error counters correctly: cumulative versus windowed deltas, which counters indicate a bad cable, and separating a degraded link from a fabric-wide problem."
date: "2026-08-24"
last_reviewed: "2026-10-17"
series: "HPC and AI infrastructure engineering"
---

Someone runs a fabric error sweep, finds a port with a symbol error count in the millions, and
schedules a cable replacement. The count is real. It may also be the accumulated total since the
switch was commissioned four years ago, in which case the cable is fine and the maintenance
window is wasted.

Error counters on InfiniBand ports are **cumulative since last reset**. A total is close to
uninterpretable on its own.

## The only reading that means anything is a delta

Take two samples with a known interval between them and subtract.

```bash
# sample, wait, sample again
ibqueryerrors --counters > /tmp/err.t0
sleep 900
ibqueryerrors --counters > /tmp/err.t1
```

Or reset deliberately and come back:

```bash
perfquery -R -a                 # reset all counters on all ports
# ... run a representative load for a known period ...
perfquery -a | grep -vE ' 0$'   # anything non-zero accumulated in that window
```

Resetting is the cleaner experiment and the one to prefer before a benchmark or an acceptance
test: a window that starts at zero needs no arithmetic and no trust in a previous sample. The
cost is that you have destroyed the history, so capture it first if anyone might want it.

What you are looking for is **rate per unit time on a link carrying traffic**. A handful of
symbol errors over fifteen minutes of heavy traffic on an NDR link is not interesting. The same
count on an idle link is, because the mechanism had almost no opportunity.

That asymmetry is why the sweep should record whether the link was loaded. "Zero errors" on a
fabric nobody is using is not a result.

## Which counters carry which meaning

Not all non-zero counters imply the same thing, and conflating them produces both false alarms
and missed faults.

| Counter | Reads as | Typical cause |
|---|---|---|
| `SymbolErrorCounter` | Physical layer noise | Cable, connector seating, transceiver, bend radius |
| `LinkErrorRecoveryCounter` | Link retrained and recovered | Marginal physical layer |
| `LinkDownedCounter` | Link went fully down | Reseat, power event, port flap, firmware |
| `PortRcvErrors` | Malformed or corrupted inbound packets | Usually downstream of symbol errors |
| `PortXmitDiscards` | Packets dropped at egress | **Congestion or credit starvation, not a cable** |
| `PortXmitWait` | Time waiting for credits | Congestion; routing imbalance; a slow endpoint |
| `VL15Dropped` | Management packets dropped | SM load, or a genuinely saturated port |
| `ExcessiveBufferOverrunErrors` | Flow control problem | Mismatched MTU/credits, firmware |

The important split: the first four are **physical**; `PortXmitDiscards` and `PortXmitWait` are
**architectural**. A port with high `XmitWait` and zero symbol errors does not have a cable
problem — it has more demand than credits, and replacing the cable will change nothing. That is
the single most common misdiagnosis in this area, because both appear in the same error sweep
output under the same heading.

High `XmitWait` concentrated on inter-switch links is a routing or provisioning finding: the
links are being asked to carry more than they can, or the routing algorithm has put more traffic
on some of them than others. That is a topology conversation, not a hardware one.

## A degraded link is not necessarily an erroring link

Separate from counters, a link can negotiate a lower width or rate and sit there perfectly
healthy, with zero errors, reporting `Active`. Four lanes becoming one is a 4x bandwidth loss
with no error counter movement at all.

```bash
iblinkinfo | grep -vE '4X +(53|106|212)'      # anything not 4X at the expected per-lane rate
```

Two traps in reading that output, both of which produce wrong capacity conclusions:

- **The rate field is per lane.** `106.25 Gbps` on a 4X link is NDR400, not 106 Gbps of link
  capacity. Multiply by the width.
- **Width is reported as `1X`/`2X`/`4X`** and a 2X link looks almost identical to a 4X one in a
  quick scan. `grep` for what you expect rather than eyeballing a long listing.

Why this matters more than the error count: on a **synchronized collective**, the job proceeds at
the speed of its slowest participant. One node at half width sets the time for every rank. So a
single silently degraded link can look exactly like a fabric-wide bandwidth problem, and chasing
it as a fabric problem — tunables, routing, firmware — can absorb days. Check every participant's
width and rate **before** you accept any synchronized benchmark number. A withdrawn performance
claim is the usual price of skipping it.

## Build the sweep so it can be compared

An error sweep is only useful against a baseline, so the output needs to be diffable.

```bash
#!/bin/bash
# one line per port, stable field order, so two runs can be diffed
set -uo pipefail
OUT=${1:-/var/log/ibsweep/$(date +%Y%m%d-%H%M).tsv}
mkdir -p "$(dirname "$OUT")"
ibqueryerrors --counters --data 2>/dev/null \
 | awk '/^Errors for/ {gid=$NF} /Counter/ {print gid"\t"$0}' > "$OUT"
echo "$OUT"
```

Then the operational question becomes a diff rather than a judgement:

```bash
diff <(cut -f1,2 baseline.tsv) <(cut -f1,2 "$OUT") | head -40
```

Two further practices that make the sweep trustworthy:

- **Record the window and the load.** A sweep row without "15 minutes, under IOR" next to it
  cannot be compared with anything.
- **Alert on the delta, not the total.** A threshold on a cumulative counter fires once and then
  fires forever, which trains everyone to ignore it.

## An order of operations

1. Capture the current totals, so history is not lost.
2. `perfquery -R -a` to reset.
3. Confirm width and rate on every link you care about — this is independent of counters and
   catches the silent case.
4. Run a representative load for a fixed period.
5. Re-read counters. Anything non-zero accumulated inside a known window with known load.
6. Split the findings: physical counters to hardware, `XmitWait`/`Discards` to topology.
7. Re-seat or replace one thing at a time, and repeat the windowed measurement. A fix is a
   counter that stays at zero through a load, not a counter you just reset.

Step 7's last sentence is where most of the remaining errors come from: resetting a counter and
observing zero proves only that you reset it.

## Symptom against cause

| Symptom | Likely reading | Next step |
|---|---|---|
| Huge symbol error total, link stable | Years of accumulation | reset, re-measure under load |
| Errors climbing on an idle link | Genuine physical fault | reseat, then swap cable |
| High `XmitWait`, zero symbol errors | Congestion or routing imbalance | topology, not cabling |
| `LinkDowned` incrementing | Flapping | check both ends, power, firmware |
| Zero errors, poor collective performance | A link at reduced width or rate | `iblinkinfo`, mind per-lane rate |
| Clean sweep, no traffic during it | The window had no load | repeat under load |

**A counter is a total, and a total is not a symptom.** Give every number a window and a load
before you let it justify a maintenance action.
