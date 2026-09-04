---
title: "LID budgets: what happens to addressing when the endpoint count changes"
date: 2026-09-04 09:00:00 -0400
category: Fabric
tags: [InfiniBand, LID, LMC, OpenSM]
summary: >-
  Every endpoint you add consumes address space and forwarding table entries.
  Both are finite, both are countable in advance, and neither fails gracefully.
---

A Local Identifier is the address a subnet manager assigns to a port so switches
can forward to it. It is sixteen bits. The unicast range runs from `0x0001` to
`0xBFFF`, which is a little over forty-eight thousand addresses, with the
remainder reserved for multicast.

Forty-eight thousand sounds like plenty, and on most fabrics it is. The number
that actually constrains you is usually not the LID space but the forwarding
table capacity of the switches, and both move when the endpoint count changes.

## What consumes a LID

Each channel adapter port gets at least one. Each switch gets one for its
management port. So a first approximation is: adapter ports, plus switches.

The multiplier is LMC.

## LMC, and why it multiplies

LID Mask Control assigns each adapter port a contiguous block of `2^LMC`
addresses instead of a single one. The point is multipathing: with several LIDs
pointing at the same port, the routing engine can compute different paths to
each, and traffic between a pair of nodes can be spread across them.

```
LMC 0    1 LID per port
LMC 1    2 LIDs per port
LMC 2    4 LIDs per port
LMC 3    8 LIDs per port
```

Set it in `opensm.conf`:

```
lmc 0
```

The cost is linear in the multiplier and it applies to every port. Going from
LMC 0 to LMC 2 does not add a few addresses; it quadruples consumption across
the entire fabric, and it quadruples the number of entries every switch has to
hold to reach those ports.

<div class="note" markdown="1">
Leave LMC at 0 unless you have established that you need multipathing and that
your routing engine will use it. Raising it is a fabric-wide cost paid to solve a
problem many fabrics do not have.
</div>

## The constraint that actually bites

Switch forwarding tables are the real limit. A linear forwarding table holds one
entry per reachable LID, and its capacity is a property of the switch silicon,
not of your configuration. When the number of LIDs in the subnet exceeds what a
switch can hold, that switch cannot route to all of them.

This is why the LID budget is not simply "am I under 48,000." It is "is every
switch able to hold an entry for every LID in the subnet," and the answer depends
on the smallest table in the fabric. A mixed-generation fabric is governed by its
oldest switch.

Check the capacity your switches actually report rather than assuming from the
model number:

```bash
ibdiagnet -o /var/tmp/ibdiag
smpquery SI <lid>          # switch info, including linear FDB capacity
saquery SI
```

## Counting before you change anything

The arithmetic is straightforward and worth doing on paper.

```
LIDs  =  (adapter ports × 2^LMC)  +  switches  +  headroom
```

Headroom matters because fabrics grow between maintenance windows, and because
a fabric at ninety-nine percent of its forwarding capacity behaves fine until the
day someone plugs in one more node.

Two changes push this number hard, and they often arrive together:

**Splitting switch ports.** Splitting does not itself consume LIDs — switches
still take one each — but it exists to let you attach more endpoints, and those
endpoints do. A split that doubles attachable ports is a plan to double the
adapter port count.

**Adding dual-port adapters, or turning on the second port.** Each active port is
an endpoint. A fleet where the second port was cabled but never brought up will
double its LID consumption the day someone brings it up, and that is rarely
recorded as a change to addressing.

Multiply the two together and a fabric that was comfortable becomes a fabric that
is not, without anyone having made a decision about addressing.

## What exhaustion looks like

It does not announce itself as an addressing problem. The symptoms are:

- Nodes that enumerate in `ibnetdiscover` but are unreachable from some parts of
  the fabric and reachable from others, because the switches that ran out are the
  ones on those paths.
- Subnet manager logs reporting failures to set forwarding table entries.
- Errors during table distribution on a sweep, often on the largest switches
  first.
- Intermittent, position-dependent reachability that looks like a cabling fault
  and survives recabling.

The tell is that it is topology-dependent rather than node-dependent. A broken
adapter fails from everywhere. An exhausted table fails from behind that switch.

```bash
grep -iE 'lid|forwarding|fdb|table' /var/log/opensm.log | tail -60
```

## Interaction with the routing engine

Routing engines use LMC differently, which matters when you are deciding whether
to raise it.

`ftree` can make use of multiple LIDs per port to distribute traffic across
parallel paths in a fat tree, and on a fabric that qualifies it is the case where
raising LMC has a defensible payoff. `updn` derives less benefit, because the
up/down constraint already limits which paths are legal. `minhop` does the least
with it.

So the sequence is: confirm which engine is genuinely running, then decide about
LMC. Raising LMC to enable multipathing under an engine that will not use it buys
you four times the forwarding table pressure and nothing else.

## Practical discipline

Record the LID count as a monitored number, not as something you look up during
an incident. It is cheap to collect and it turns a class of confusing failures
into a threshold you crossed.

Recompute the budget as part of planning any change to endpoint count — new
nodes, split ports, second ports brought up, a new storage tier. The calculation
takes a few minutes and the alternative is discovering the limit during a
maintenance window with the change half applied.

And keep LMC deliberate. It is one line in a configuration file and it is the
single largest multiplier on everything above.
