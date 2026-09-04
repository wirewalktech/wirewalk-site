---
title: "Splitting ports on Quantum switches: what it costs you"
date: 2026-09-04 07:00:00 -0400
category: Fabric
tags: [InfiniBand, Quantum, Topology, Port splitting]
summary: >-
  Doubling your port count is the easy part. The parts that surprise people are
  the renumbering, the cabling, and what it does to the subnet manager.
---

Port splitting turns one high-rate port into two or four lower-rate ports. On a
Quantum-class HDR switch that is 40 ports at HDR200 becoming 80 at HDR100. On a
Quantum-2 NDR switch it is 64 logical NDR400 ports, presented through 32 physical
cages, becoming 128 at NDR200.

The reason to do it is almost always economics. If your endpoints have HDR100 or
NDR200 adapters, an unsplit switch wastes half of every port's capability, and
you buy twice the switches you need. The reason to think carefully first is that
splitting changes four things at once, and only the first is obvious.

## What a cage actually carries

The physical connector is not the port. On Quantum-2, one OSFP cage carries eight
lanes, presented by default as two NDR400 ports of four lanes each. Split, those
same eight lanes present as four NDR200 ports of two lanes each. Nothing about
the switch got faster or slower; the lanes were regrouped.

This is why the aggregate switch bandwidth does not change when you split, and
why "we doubled the ports" and "we doubled the capacity" are different claims.
You have the same total, divided more finely.

## The renumbering

Split ports get a new naming scheme, and every piece of tooling that referenced
the old names breaks quietly.

```
unsplit      1/1        1/2        1/3
split        1/1/1 1/1/2   1/2/1 1/2/2   1/3/1 1/3/2
```

Anything holding port identifiers is now wrong: monitoring definitions, cabling
records, port-to-node maps, error-counter baselines, and any script that walks a
port list. None of that fails loudly. It just reports on ports that no longer
exist, or misses ports that now do.

Regenerate the topology from the fabric rather than editing your records by hand:

```bash
ibnetdiscover > topology-$(date +%F).txt
iblinkinfo
ibdiagnet -o /var/tmp/ibdiag-$(date +%F)
```

Do that before the change as well as after. The diff is what you hand to whoever
maintains the monitoring.

## Enabling it

The exact syntax depends on the switch OS release, and this is one of the places
where an old runbook will mislead you. The general shape on MLNX-OS is a system
profile that permits splitting, then a per-port module type, then a reboot:

```
switch (config) # system profile ib split-ready
switch (config) # interface ib 1/1 module-type qsfp-split-2
switch (config) # write memory
switch (config) # reload
```

Three things to check against your own release notes rather than against this:
whether the profile change is required at all on your platform, whether the
split factor is expressed as `split-2` or `split-4`, and whether the reboot is
required or merely recommended. Treat the vendor documentation for your exact
firmware as authoritative.

**The reboot is the real constraint.** Enabling split-ready mode is a switch
restart, which is a fabric event. On a single-switch fabric that is an outage. On
a leaf-and-spine fabric it is a capacity reduction and a routing re-convergence,
and if it is a spine, it is a large one. Plan it as maintenance, not as a
configuration change.

## Cabling

A split port needs a splitter cable, and the breakout ratio has to match the
configured split factor. A two-way split needs a two-way breakout; a four-way
split needs a four-way. Mixing them produces ports that never link, with no error
message that says why.

Two practical points. Splitter cables are physically bulkier at the switch end
and have real bend-radius limits, which matters in a dense cabinet more than the
datasheet suggests. And a partially split switch — some cages split, some not —
is entirely legal and genuinely useful, but it makes the cabling records the only
source of truth about which is which. Label at both ends.

## What it does to the subnet

This is the part that gets underestimated.

Splitting increases the number of endpoints the subnet manager has to
enumerate, assign and route. Every added endpoint consumes at least one LID,
occupies entries in the forwarding tables of every switch on any path to it, and
adds work to every sweep.

Three consequences:

- **Routing table pressure.** Switch forwarding tables have a hard capacity.
  Doubling endpoint count moves you toward that limit, and the failure mode when
  you reach it is not graceful.
- **Longer sweeps.** More ports means more discovery and more table
  distribution. On a large fabric the difference between a sweep that finishes
  quickly and one that does not is operationally significant, because sweeps
  happen on every topology change.
- **Changed oversubscription.** If you split leaf ports facing compute and leave
  the spine uplinks alone, you have just changed the ratio between edge and core
  capacity. That number should be a decision, not a side effect.

<div class="note" markdown="1">
Work out the LID budget and the forwarding table headroom before you split, not
after. Both are countable in advance, and both are much cheaper to discover on
paper than during a maintenance window.
</div>

## Verifying it took

After the reboot, confirm the switch presents what you expect, then confirm the
subnet manager agrees:

```bash
ibswitches
iblinkinfo | grep -c Active
ibdiagnet -o /var/tmp/ibdiag-after
sminfo
```

Compare the port count and the link rates against what you intended. A cage that
split but whose cable did not match will show ports in a down or polling state
rather than an error, so count active links rather than trusting the absence of
errors.

Then check the error counters are clean from a fresh baseline, because the old
baseline referred to ports that no longer exist:

```bash
ibclearerrors
# run representative traffic
ibqueryerrors
```

## When not to split

If your endpoints have full-rate adapters, splitting throws away half of each
one's capability for no gain. If you are already close to the forwarding table
limit, splitting is how you find the limit. And if the fabric is a single switch
with no maintenance window available, the reboot is the whole problem and no
amount of planning removes it.

Splitting is a good answer to a specific question: you have more endpoints than
ports, and those endpoints do not need full rate. Outside that question it is
usually the wrong tool.
