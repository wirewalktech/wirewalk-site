---
title: "Changing the OpenSM routing engine: updn, ftree, and the silent fallback"
date: 2026-09-04 08:00:00 -0400
category: Fabric
tags: [OpenSM, Routing, Fat tree, InfiniBand]
summary: >-
  Setting routing_engine does not mean the engine you named is the engine you
  got. ftree in particular declines the job and hands it back, and it does so in
  a log line most people never read.
---

The subnet manager decides which path every packet takes through the fabric, and
the routing engine is the algorithm it uses to decide. Changing it is a one-line
edit to `opensm.conf`. Confirming that the change actually took is the part worth
learning, because one of the common engines refuses fabrics it does not like and
falls back to another without failing.

## The engines worth knowing

**`minhop`** routes by shortest path. It is simple, fast to compute, and offers
no protection against credit loops. On a topology where cycles are possible, that
is a deadlock waiting for the right traffic pattern. It is a reasonable default
on small, regular fabrics and a poor one on anything irregular.

**`updn`** applies an up/down turn rule: traffic may go up the tree and then
down, but never up again after descending. That constraint makes credit loops
impossible on an arbitrary topology, which is why up/down is the safe answer when
you do not know what shape the fabric is. The cost is path quality — some routes
are longer than they need to be, and the distribution across links is uneven.

Up/down depends entirely on which nodes it treats as roots. Left to itself,
OpenSM guesses, and the guess is often poor on a fabric where spine and leaf
switches are not obviously distinguishable. Give it the answer explicitly:

```
routing_engine updn
root_guid_file /etc/opensm/root_guids.txt
```

That file holds one spine switch GUID per line. Getting it right is the
difference between up/down performing acceptably and performing badly, and it is
the most common thing left undone.

**`ftree`** is optimised for fat trees, and on a fabric that genuinely is one it
produces materially better link utilisation than up/down. It also has strict
requirements about what counts as a fat tree: the topology must be regular,
constant bisectional bandwidth, with the compute nodes at the leaves and a
consistent number of links between tiers.

**`dnup`** inverts the up/down rule, and is occasionally the better fit where the
traffic pattern is dominated by leaf-to-leaf rather than leaf-to-core.

There are others — `lash`, `dor`, `torus-2QoS`, `dfsssp` — that matter on
specific topologies. If you are running a torus or a dragonfly, the engine is not
a matter of taste and the vendor guidance for that topology governs.

## The silent fallback

`routing_engine` accepts an ordered, comma-separated list, and that is not a
preference list in the way people assume. It is a fallback chain:

```
routing_engine ftree,updn,minhop
```

OpenSM tries `ftree`. If the fabric does not satisfy its requirements, it logs
the reason and moves to `updn`. The subnet comes up. Traffic flows. Nothing
appears to be wrong. You are simply not running the engine you configured, and
the performance you were expecting from the change does not arrive.

This happens more often than it should, for mundane reasons: one node cabled to
a spine instead of a leaf, a leaf with a different uplink count from its
siblings, a switch that was down during the sweep, a section of the fabric added
later with a different ratio.

<div class="note" markdown="1">
After changing the engine, read the log and confirm which one is actually
running. Do not infer it from the configuration file. The configuration file
records what you asked for.
</div>

## Confirming what is running

The subnet manager log is the primary source:

```bash
grep -iE 'routing engine|ftree|fallback|topology' /var/log/opensm.log | tail -40
```

You are looking for a line naming the engine that was used, and — if `ftree`
declined — a line explaining why. That explanation is usually specific enough to
fix: it will name the node or the tier that broke the assumption.

For a fuller picture, have OpenSM write out what it computed:

```bash
opensm --dump_files_dir /var/tmp/osm-dump -o
```

`-o` runs a single sweep and exits, which is what you want for inspection rather
than for taking over the subnet. The dump directory gets the LID matrices and
the per-switch forwarding tables, which is the ground truth about where traffic
will actually go.

Then confirm from the fabric side:

```bash
sminfo
ibdiagnet -o /var/tmp/ibdiag --routing
```

## Applying a change

Routing is recomputed on a sweep, and the engine is read at startup. A change
means restarting the subnet manager:

```bash
systemctl restart opensm
```

Two cautions. On a large fabric the recompute and redistribution of forwarding
tables is not instant, and traffic during that window can take paths that are in
the process of changing. Do this in a maintenance window on anything busy.

And if you run a standby subnet manager, its configuration has to change too.
A failover onto a standby still holding the old engine will silently reroute the
entire fabric back, and the resulting "the fabric got slow again for no reason"
is genuinely hard to diagnose if you have forgotten the standby exists.

## Measuring whether it helped

The point of changing engines is link utilisation, so measure that rather than a
single pair's bandwidth.

Point-to-point between one pair of nodes is usually indifferent to the routing
engine, because a single flow takes a single path either way. What changes is
what happens when many flows share the fabric. Use an all-to-all or an all-reduce
across the real job size:

```bash
mpirun -np <ranks> ./osu_alltoall
mpirun -np <ranks> ./build/all_reduce_perf -b 1G -e 1G -n 20
```

Take a baseline before the change, on the same node set, and compare. Also look
at per-port counters across the spine after a representative run: an engine that
is distributing well produces even traffic across parallel uplinks, and one that
is not produces a visible imbalance. That imbalance is often easier to see, and
more convincing, than a bandwidth number.

## Adaptive routing is a different layer

Modern switches can make per-packet forwarding decisions to route around
congestion. That is a switch feature, configured on the switch and in some cases
coordinated by the fabric manager, and it operates on top of whatever path set
the subnet manager computed. It is not a substitute for choosing the right
routing engine, and enabling it does not repair a fabric whose static routing is
badly distributed. Get the static routing right first, then decide whether
adaptive routing adds anything.

## The short version

Set the engine, restart, then read the log to find out which engine you are
actually running. Give `updn` an explicit root list. Expect `ftree` to decline if
anything about the topology is irregular, and treat its explanation as a cabling
bug report rather than a configuration problem. Measure with collectives, not
with a single pair.
