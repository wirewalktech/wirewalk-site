---
title: "NFS security: root squashing does not authenticate every user"
category: "Storage security"
tags: ["NFS", "Kerberos", "Linux"]
summary: "Client trust, user identity, integrity, and encryption are separate choices in an NFS design."
date: "2025-03-27"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

An export restricted to a subnet can still trust more client authority than its owner intended. Before tightening filesystem permissions, establish how the server decides which user made each request.

## Distinguish the security flavors

The Linux NFS export manual documents `sec=sys` and Kerberos flavors. `krb5` provides Kerberos authentication, `krb5i` adds integrity, and `krb5p` adds privacy. It also documents root squashing, which maps client root requests to an anonymous identity rather than treating them as server root. See [exports(5)](https://man7.org/linux/man-pages/man5/exports.5.html).

Root squashing does not turn client-supplied AUTH_SYS user IDs into independently authenticated identities. That matters when a client is shared, unmanaged, or compromised. Evaluate the trustworthiness of the client host as part of the export's security boundary.

## Inspect what the client actually mounted

On a Linux NFS client:

```bash
findmnt -t nfs,nfs4
nfsstat -m
id
klist
```

The last command requires Kerberos client tools and reports the current ticket context. Its absence does not diagnose the server. Compare negotiated mount options with server export settings and the application's actual execution identity.

Do not assume that an entry in a proposed mount configuration describes an already established mount. Inspect the running system.

## Test identities, not just connectivity

Use a dedicated export with synthetic files. Test an authorized user, an unrelated user, and a client root process. Define which read, create, rename, and permission-changing operations should succeed before running the test.

If Kerberos is required, include a fresh session without a usable ticket and a session with the intended credentials. Long-running jobs need a documented credential-lifetime strategy. A successful interactive mount does not prove a batch job will continue working several hours later.

Evaluate directory permissions as well as file permissions. A user may be unable to alter file contents but still be allowed to rename or remove a directory entry.

## Treat migration as an interoperability test

VAST, PowerScale, WEKA, and Linux NFS servers do not expose identical configuration interfaces. Check the supported security flavors, release constraints, identity integration, and client requirements for each platform. Do not paste Linux `/etc/exports` syntax into an appliance runbook.

Kerberos introduces dependencies on time, name resolution, principals, and key distribution. Benchmark the application's real workload with the required security settings rather than disabling privacy to obtain a more attractive throughput number.

## Acceptance criteria

Retain the negotiated security flavor, identity used, expected-versus-observed operation matrix, and long-running job result. Document residual client trust explicitly when AUTH_SYS remains necessary. Network segmentation and managed clients can reduce exposure, but they should not be described as cryptographic user authentication.

Related: [PowerScale multiprotocol identities](/writing/powerscale-multiprotocol-identity-acls/).
