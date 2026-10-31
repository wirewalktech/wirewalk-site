---
title: "GPFS multihomed storage: when ARP filtering hides a second RDMA path"
date: "2026-10-25 10:00:00 -0400"
category: "Parallel Storage"
tags: ["GPFS", "IBM Storage Scale", "IPoIB", "RDMA", "Policy Routing", "ARP"]
summary: "Diagnose a missing GPFS storage path by tracing IPoIB neighbor discovery, ARP filtering and source routing. Preserve peer traffic, verify both RDMA paths and make the fix survive interface changes."
description: "Fix missing GPFS RDMA paths on multihomed storage nodes: IPoIB neighbor discovery, ARP filtering, source routing, peer exceptions and verified recovery."
---

A storage server can have two healthy InfiniBand ports and still serve its clients through only one. The filesystem remains available. Jobs keep running. The unused capacity becomes easy to overlook because the system is working, just with fewer useful paths than its design intended.

Before buying more storage or changing GPFS tuning parameters, check whether clients can discover and reach every storage address they are supposed to use. An IPv4 neighbor-discovery problem can prevent an intended RDMA path from becoming usable in the first place.

The corrective pattern here is **source-based routing with the existing ARP policy left in place**. It is not a recommendation to disable ARP filtering across a storage fleet.

*This is a generalized engineering example. The address plan, names, interface labels and routing identifiers are illustrative. Production logs, inventory, incident dates and benchmark figures are deliberately omitted.*

## Start with the missing path, not the aggregate throughput

The useful symptom is a disagreement between the intended topology and the connections actually carrying client traffic. A server's second port may be active for storage-peer traffic while remaining unused by clients. Link state alone cannot distinguish those cases.

Build a small observation set: one affected client, one multihomed storage server, and the corresponding interfaces. Record client-to-storage connections separately from storage-to-storage connections. Measure traffic during a known workload using RDMA hardware-counter deltas, with timestamps and understood units.

An IPoIB packet capture helps explain IP and ARP exchanges; it is not a complete capture of the verbs data stream. Likewise, a successful IPv4 ping establishes only one layer of reachability. Neither observation, on its own, proves that GPFS is moving data through both RDMA paths.

This discussion concerns an IPoIB configuration in which RDMA connection establishment depends on the relevant IP addresses being reachable. Check the installed Storage Scale release and its RDMA configuration first. IBM documents `verbsRdmaCm` and `verbsPorts` in the [configuration reference](https://www.ibm.com/docs/en/storage-scale/5.2.3?topic=reference-mmchconfig-command). Multiple RDMA ports, multiple daemon-network addresses, and TCP multirail are distinct configuration questions.

## A simplified overlapping address plan

Suppose one shared InfiniBand fabric carries the following illustrative configuration:

| Endpoint | Interface | IPv4 address or range |
|---|---|---|
| Client | `ib0` | `192.0.2.23/24` |
| Storage server, primary path | `ib0` | `192.0.2.81/24` |
| Storage server, additional path | `ib1` | `192.0.2.209/25` |
| Primary addresses of storage peers | — | `192.0.2.80/28` |

These addresses use the [documentation prefix reserved by RFC 5737](https://www.rfc-editor.org/rfc/rfc5737.html). They are not an address plan to deploy.

The important relationship is that `192.0.2.128/25`, the additional interface's subnet, lies inside the client's broader `192.0.2.0/24` network. The example client is outside that narrower subnet. Both interfaces can attach to the shared fabric while the main routing table makes different choices for their destinations.

A simplified main table on the storage server contains:

```text
192.0.2.0/24 dev ib0 src 192.0.2.81
192.0.2.128/25 dev ib1 src 192.0.2.209
```

A lookup for the client selects `ib0`. A lookup for an address inside the narrower subnet selects `ib1`. This is normal longest-prefix route selection. It becomes a problem when the server's ARP reply policy expects the return route for an address on `ib1` to use `ib1`.

Two ports on one fabric also do not constitute two independent fabrics. Reachability, available bandwidth and failure isolation need separate acceptance criteria.

## Understand which filter is making the decision

For this failure pattern, the relevant policy has `arp_filter=1`. The kernel considers routing when deciding whether to answer an ARP request on an interface. A request for the additional address can arrive on `ib1`, yet fail that decision because a route back to the requesting client selects `ib0`.

`arp_ignore=1` is different: it restricts replies to target addresses configured on the receiving interface. `arp_announce` concerns source-address selection in outgoing ARP requests. `rp_filter` checks the source of received IPv4 packets; it does not filter ARP frames.

The [Linux IPv4 sysctl documentation](https://www.kernel.org/doc/html/v6.12/networking/ip-sysctl.html) explains these distinctions and the source-routing requirement for `arp_filter`. It also documents how `all` and interface-specific values interact. `default` supplies settings for interfaces created later; it is not a readback of every existing interface.

The policies must agree with the routing design. Relaxing them may hide an incorrect path, change which interface answers, or expose a separate reverse-path problem. Establish the decision being made before changing it.

## Capture the failing discovery exchange

On the client, first establish how the additional storage address would be reached:

```bash
ip -4 route get 192.0.2.209
ip -4 neigh show to 192.0.2.209 dev ib0
```

For this example, the client should regard the address as on-link through its IPoIB interface. If a gateway or another interface appears instead, investigate that route before attributing the failure to the storage server.

Observe a bounded probe from the client:

```bash
ping -I 192.0.2.23 -c 3 192.0.2.209
ip -4 neigh show to 192.0.2.209 dev ib0
```

The source address must be assigned to that client. An `INCOMPLETE` or `FAILED` neighbor entry is evidence that resolution did not complete, not proof of why it failed.

On the storage server, watch the candidate receiving interface while the probe runs:

```bash
timeout 15 tcpdump -ni ib1 -c 20 arp
```

The timeout bounds the observation; reaching it is not itself a diagnosis. Confirm whether requests arrive and whether replies leave. If requests never arrive, investigate the client path, fabric membership and interface configuration. If replies leave but never reach the client, investigate the return path and receiving side. The routing-policy hypothesis becomes stronger when requests arrive on the expected interface but the server does not answer them.

Keep captures local to the investigation. IPoIB link-layer addresses, hostnames and management details can identify an environment just as readily as ordinary IP addresses.

## Ask for the route with the correct source

On the storage server, collect the actual state:

```bash
ip -4 -brief address show
ip -4 rule show
ip -4 route show table main

for scope in all default ib0 ib1; do
    sysctl "net.ipv4.conf.${scope}.arp_filter"
    sysctl "net.ipv4.conf.${scope}.arp_ignore"
    sysctl "net.ipv4.conf.${scope}.rp_filter"
done
```

Then compare route lookups that preserve the source address of each storage path:

```bash
ip -4 route get 192.0.2.23 from 192.0.2.81
ip -4 route get 192.0.2.23 from 192.0.2.209
```

If both choose `ib0`, the additional address has no source-specific policy returning to this client through `ib1`. The destination-only lookup was insufficient to expose that distinction.

The [ip-route reference](https://man7.org/linux/man-pages/man8/ip-route.8.html) documents source-qualified lookups. Run them in the network namespace that owns the relevant interfaces. A lookup is a routing observation, not proof that every receive-side check will accept a packet; the bounded probe and capture still matter.

Repeat this analysis for storage peers and management destinations. A source-only rule can affect more traffic than the client connection that motivated it.

## Design the exception before the broad rule

The proposed policy for this example has three parts:

1. A dedicated table sends client-network destinations through the additional interface.
2. A higher-priority exception keeps the primary storage-peer range on its existing main-table policy.
3. A following rule directs other traffic sourced from the additional storage address to the dedicated table.

The exception is important because the client network contains the primary storage-peer range too. Without it, a broad source rule would also change those peer route decisions.

Here is an explicit **plan printer**, not an applying script:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Entirely illustrative values. This block only prints a proposed change.
printf '%s\n' \
  'ip -4 route replace 192.0.2.0/24 dev ib1 src 192.0.2.209 table 210' \
  'ip -4 rule add priority 12200 from 192.0.2.209/32 to 192.0.2.80/28 lookup main' \
  'ip -4 rule add priority 12210 from 192.0.2.209/32 lookup 210'
```

Table `210` and priorities `12200` and `12210` are arbitrary examples. Inventory existing tables and rules, then allocate identifiers that the site's configuration system owns. Verify the address assignment, intended on-link reachability, table contents and rule ordering before applying a reviewed equivalent.

Linux evaluates policy rules in priority order, with lower numeric values first. The [ip-rule reference](https://man7.org/linux/man-pages/man8/ip-rule.8.html) describes selectors and table lookups. Here the peer exception is considered before the additional-path rule, and both precede the ordinary main-table rule in a typical default configuration. Existing rules can change that outcome; read the complete policy database.

A dedicated table with no default route does not necessarily block other destinations. If its lookup finds no route, policy processing can continue to later rules. Decide whether that fallback is wanted, especially for management traffic. Do not add a default route merely to make the table look complete.

For a new design, consider a simpler, release-supported network arrangement first. Source routing is a way to reconcile this particular overlapping configuration, not a reason to create overlapping subnets on every new cluster.

## Verify the route matrix and the peer exception

After applying an authorized, site-specific change on one canary, check all of the following:

```bash
ip -4 rule show
ip -4 route show table 210

# Primary source to client: retain the primary path.
ip -4 route get 192.0.2.23 from 192.0.2.81

# Additional source to client: select the additional path.
ip -4 route get 192.0.2.23 from 192.0.2.209

# Primary storage-peer destination: retain the main-table decision.
ip -4 route get 192.0.2.82 from 192.0.2.209

# Additional-path peer destination: inspect its intended path too.
ip -4 route get 192.0.2.210 from 192.0.2.209
```

The expected interfaces in this simplified example are `ib0`, `ib1`, `ib0` and `ib1`, respectively. Verify management and any other policy-sensitive traffic separately.

Returning a peer destination to the main table preserves its previous route decision. It does not, by itself, prove that an application has selected the intended source or formed the desired same-rail connections. Inspect those connections and their traffic.

Repeat the client probe. Neighbor discovery should now complete through the intended storage interface, and IPv4 reachability should work without changing the existing filtering policy. If ARP completes but IP traffic still fails, examine reverse-path filtering, packet filters and the actual return path. Avoid changing several of these controls together and losing the evidence that distinguishes them.

## Recheck GPFS after network reachability is repaired

Restoring IP reachability and obtaining the intended GPFS connection layout are separate steps. In the environment behind this example, already-running clients retained their earlier connection layout after the route change. That observation should not become a universal claim that every Storage Scale release retries addresses in the same way or reports failures identically.

Check the installed release's connection diagnostics, including the supported views of:

```bash
mmlsconfig verbsRdmaCm
mmlsconfig verbsPorts
mmdiag --network
mmdiag --verbs
```

Use `--network` for daemon connections and pending RPCs, and `--verbs` for RDMA port state. IBM describes these diagnostics in the [mmdiag reference](https://www.ibm.com/docs/en/storage-scale/5.2.3?topic=reference-mmdiag-command). Correlate the reported connections with client and storage addresses, adapters and per-port activity. Additional connection records alone do not establish balanced use or a particular throughput improvement.

If a client needs a reconnect or daemon restart, use its normal maintenance procedure. Account for active jobs, mounted filesystems, services and other users of that node before taking it out of service. Validate mounts and a representative scheduled workload before readmission. Storage servers have additional availability responsibilities; a client-side observation is not permission to restart them as a group.

The useful acceptance evidence is that the intended client paths exist and carry the workload, while storage-peer and management behavior remain correct.

## Make the policy survive an interface cycle

A live route change is only one part of the fix. Define which configuration system owns the route, rules and any supporting service, including the corresponding machine image.

In a service-and-dispatcher design, arrange for policy reconciliation after the interface has its address and before consumers depend on that path. Reapply the route when a network profile is reactivated: link lifecycle events can remove routes while leaving policy rules behind.

A production helper should default to a printed plan and require an explicit `--go` to mutate state. It should detect conflicting ownership, reconcile rather than duplicate rules, and report failure when a required interface or address is missing. “Nothing to do” must not be reported as readiness when GPFS requires that path.

Service ordering is not the same as a readiness dependency. A `Before=` relationship orders jobs that are already scheduled; it does not independently require the policy job to run successfully. Test the dependency and failure behavior used by the site's actual GPFS service arrangement.

Verify an interface reactivation and a controlled reboot through the normal maintenance process. Files installed in an image, an enabled unit and a successful live application are three observations; none substitutes for that lifecycle test.

## Roll back only the state this change owns

Save the original rules, affected routes and persistence configuration before the canary change. The rollback plan must remove or restore the exact owned rules, the dedicated route and the mechanism that would recreate them.

Avoid flushing the main table, deleting rules by a broad text match, or flushing a custom table that contains unrelated routes. If a change replaced an existing route, restore that route rather than merely deleting the replacement. Keep the management route and a recovery console available throughout the change.

After rollback, repeat the route matrix, neighbor probe, GPFS connection inspection and node-readiness checks. Recovery is demonstrated by the resulting state, not just by a script returning zero.

## Establish usable paths before sizing the next upgrade

Compare a representative workload before and after the change using matched clients, data, concurrency and cache conditions. Capture per-port traffic and application progress together. Do not infer a fixed speedup from the number of ports, or describe a storage-to-storage connection as evidence of client bandwidth.

This example deliberately omits production benchmark results. The transferable lesson is the diagnostic sequence: identify the missing path, observe neighbor discovery, read the source-qualified route decision, preserve peer policy, and then verify the application and lifecycle behavior.

That sequence can reveal capacity the system was already intended to provide. For the people waiting on an analysis or a training run, making an existing path usable can matter more than another round of storage tuning.
