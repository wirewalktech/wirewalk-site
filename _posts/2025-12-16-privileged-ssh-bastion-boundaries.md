---
title: "Privileged SSH: make the bastion a real boundary"
category: "Identity"
tags: ["OpenSSH", "Bastion", "Privileged access"]
summary: "A jump host is useful only when direct access, forwarding, and downstream authority are deliberately controlled."
date: "2025-12-16"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

Putting a bastion in a network diagram does not force administrators to use it. If managed hosts still accept direct connections from broad networks or share long-lived keys, the new hop may add logging while leaving the original access path intact.

## Define the authorized route

Document which administrator devices can reach the bastion, which hosts it can reach, and which identities are accepted downstream. Separate ordinary user access from privileged maintenance. Keep a tested emergency route for recovery, with explicit ownership and audit.

The boundary includes network policy and host authentication. Neither one substitutes for the other.

## Inspect effective OpenSSH settings

OpenSSH documents configuration processing, `Match` rules, forwarding controls, and authorized principals in [sshd_config](https://man.openbsd.org/sshd_config). On a Linux lab server with an installed OpenSSH daemon:

```bash
sudo sshd -t
sudo sshd -T
```

The first checks configuration validity; the second displays effective settings for the default context. Where `Match` blocks are used, test the intended connection context with the version-supported `-C` options as well. Keep the output restricted because it reveals security configuration.

Do not assume that the last line in a configuration file overrides earlier values. Includes and first-obtained-value behavior make visual inspection alone unreliable.

## Test the access matrix

Use a pilot host and test four cases: approved administrator via bastion, unrelated user via bastion, direct connection from an ordinary client network, and the emergency path. Define the expected result for each.

Test both authentication and privilege elevation. An account that can log in but cannot perform the approved task is an operational failure; an account that can become root everywhere may be broader than intended.

If certificates are used, test expired and unauthorized principals with disposable credentials. Certificate issuance policy and signer protection become part of the access boundary.

## Review forwarding and sessions

Agent, TCP, and other forwarding features can extend authority beyond the apparent login route. Disable unnecessary features using the supported controls and test the workflows that remain. OpenSSH also notes that forwarding restrictions are not complete confinement for a user who can execute arbitrary code on the host.

Record session start, identity, destination, and privileged actions according to the organization's logging policy. Do not promise full command attribution merely because SSH authentication logs exist.

## Roll out without losing recovery

Keep a working rescue session and independently verified console access during the pilot. Apply changes to a small group, establish a new session through the intended route, and verify both allowed and denied behavior before expanding.

The result should be a route enforced by network and host policy, with bounded downstream authority and a working recovery path. See [management-network isolation](/writing/management-network-bmc-isolation/) for the infrastructure beneath that route.
