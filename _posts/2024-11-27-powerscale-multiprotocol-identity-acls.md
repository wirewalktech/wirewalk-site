---
title: "PowerScale multiprotocol access: prove who the same user becomes"
category: "Storage security"
tags: ["PowerScale", "Isilon", "Active Directory", "NFS", "SMB"]
summary: "An SMB login and an NFS identity can reach the same files through different mappings. Test both paths."
date: "2024-11-27"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

A user can appear correctly restricted from a Windows workstation and still gain unexpected access through a Linux client. The files did not change; the identity and authorization path did. This is a central security test for a PowerScale estate serving both SMB and NFS.

## Map identity before editing permissions

OneFS supports directory services, access zones, and identity mapping across protocol identities. Dell describes combining identities into an access token and configuring mappings within individual zones. See [identity management](https://www.dell.com/support/manuals/en-us/isilon-onefs/ifs-pub-9900-administration-guide-gui/identity-management-overview?guid=guid-b028d620-cb7c-432d-b03f-983aa36db9ca&lang=en-us) and [user mapping](https://www.dell.com/support/manuals/en-us/isilon-onefs/ifs_pub_9700_administration_guide_gui/user-mapping?guid=guid-0498c400-ff06-4eb6-bd27-854c7b6e9021&lang=en-us).

For one affected file, record the client protocol, zone, authentication provider, user SID or UID, groups, and effective file permissions. Do not start with a recursive permission change. That destroys evidence and can widen access across a much larger tree.

## Construct a small access matrix

Use a test share and export containing synthetic data. Choose an owner, a same-team reader, and an unrelated user. Exercise each from both client types.

| Operation | Owner | Reader | Unrelated user |
|---|---|---|---|
| Read existing file | Allow | Allow | Deny |
| Create new file | Allow | Deny | Deny |
| Rename or delete | Allow | Deny | Deny |
| Change permissions | Explicit policy | Deny | Deny |

This is an example policy, not a default OneFS behavior. Adapt it to the application. Test the directory as well as the file, because creation, rename, and deletion involve directory authorization.

## Inspect the client view

On a Linux client with the relevant utilities installed, these are read-only starting points:

```bash
id
findmnt -t nfs,nfs4
ls -ln /mnt/security-lab
getfacl /mnt/security-lab/example.txt
```

`getfacl` is a client-side view; it does not necessarily expose every server-side Windows ACL semantic. Pair it with OneFS effective-identity and ACL inspection for the installed release. On Windows, inspect the actual connected identity and both share and file permissions.

Repeat the access test after a group membership change using a new authenticated session. An existing session or cached token can preserve old access and make the timing look inconsistent.

## What a migration must preserve

Before moving a directory tree, capture ownership, inherited ACL behavior, identity mappings, and application service identities. A byte-identical copy can still be an authorization failure if SID-to-UID mapping changes at the destination.

Accept the migration only when the expected allowed and denied operations agree on both protocols. Keep the test users and synthetic dataset for later directory or OneFS upgrades. This small regression suite is more useful than a one-time screenshot of permissions.

Related: [NFS authentication boundaries](/writing/nfs-auth-sys-kerberos-boundaries/).
