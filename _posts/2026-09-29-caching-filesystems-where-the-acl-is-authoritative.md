---
title: "On a caching filesystem, decide which side owns the ACL"
category: Storage
tags: ["GPFS AFM", "NFSv4 ACLs", "POSIX Permissions", "Caching", "Isilon", "Parallel Filesystem", "Access Control"]
summary: >-
  Set an ACL on the cache and it reverts, because the home side is
  authoritative and revalidation overwrites what you did. Add chmod silently
  destroying NFSv4 ACLs and you have permissions that appear to work and then
  stop.
description: "Why ACLs set on an AFM cache fileset revert to the home filesystem's values, why chmod destroys an NFSv4 ACL while chown preserves it, and how to verify a grant with a negative control."
date: "2026-09-29"
archive_date: true
published_on: "2026-10-17"
last_reviewed: "2026-10-17"
series: "HPC and AI infrastructure engineering"
---

Giving a collaborator access to a dataset is a five-minute job that occasionally takes a day.
The long version happens on caching filesystems, where the thing you edited is not the thing
that decides.

## The cache is a view, and views do not own data

In a caching architecture — AFM over NFS being the common one in HPC, with an enterprise NAS as
the home filesystem — the cache fileset holds a local copy of data whose authority lives
elsewhere. Reads are served locally; metadata is revalidated against home on an interval; and
when the two disagree about metadata, **home wins**.

Permissions and ACLs are metadata. So:

```bash
nfs4_setfacl -a 'A::collaborator@domain:rxtncy' /gpfs/cache/dataset/
# correct output immediately afterwards
nfs4_getfacl /gpfs/cache/dataset/
# ... and the grant is gone some tens of seconds later
```

Nothing failed. The revalidation interval elapsed, the cache asked home what the metadata
should be, and home said something different. The grant you applied was overwritten by the
design of the system.

The fix is structural, not a different command: **apply the ACL on the home filesystem.** Set it
on the NAS, let it propagate into the cache, and verify on the cache side that it arrived. If
your access to the NAS is through a different team, that is the real dependency in the task, and
discovering it before you promise a timeline is the whole value of knowing this.

Two things worth establishing before you start:

```bash
mmlsfileset <fs> <fileset> --afm -L     # is this a cache, and what is home?
mmafmctl <fs> getstate                  # cache state, gateway, queue depth
```

A cache in `Dirty` state with a deep queue is still serving reads and is not an error by itself,
but it does mean local changes are pending writeback, and it is the wrong moment to be reasoning
about whose metadata is current.

## chmod destroys an NFSv4 ACL; chown does not

Independent of caching, and the single most common way a working grant disappears.

NFSv4 ACLs and the POSIX mode bits are two representations of overlapping state. On most
implementations, `chmod` does not *merge* with an existing ACL — it **replaces** it with the
three-entry OWNER/GROUP/EVERYONE form implied by the mode. Every explicitly named user or group
is discarded, silently, with a zero exit status.

```bash
nfs4_getfacl ./data | wc -l     # 7 entries
chmod 750 ./data
nfs4_getfacl ./data | wc -l     # 3 entries. The grant is gone.
```

`chown` is safe: it changes the owner, and the ACL survives.

The practical consequence is about ordering and about other people's scripts. Set ownership
first, ACLs second, and never let a cleanup script run `chmod -R` over a tree whose access
depends on ACLs. A "tighten permissions" cron job is a perfectly good way to revoke a
collaborator's access three weeks after you granted it, and the only trace is that it used to
work.

Related trap in the same family: some tooling writes **new** files without the ACL even where
directories keep it. Decryption and extraction utilities are frequent offenders — the output
directory shows `+` in `ls -l` and the files inside do not. Check files, not just directories.

## Inheritance is a property of the entry, not of the directory

A grant on a directory that does not carry inheritance flags applies to that directory and
nothing created in it afterwards. The result is access that works for existing content and
fails for everything the project produces from then on, which reads like an intermittent fault.

```bash
nfs4_setfacl -a 'A:fd:collaborator@domain:rxtncy' /path/dir
```

The `fd` flags — file-inherit, directory-inherit — are what make new content inherit. Add `i`
(inherit-only) when the entry should apply to children but not to the directory itself.

Verify inheritance by **creating something**, not by reading the ACL you just set:

```bash
touch /path/dir/.inherit-probe && nfs4_getfacl /path/dir/.inherit-probe | grep collaborator
rm -f /path/dir/.inherit-probe
```

## Verify with a negative control

Reading back the ACL confirms the ACL. It does not confirm access, and it certainly does not
confirm that access is *limited* to who you intended. Two tests, both cheap:

```bash
# positive: can the intended identity read?
sudo -u collaborator test -r /path/dir/file && echo grant-ok

# negative: can an unrelated identity read? It must NOT.
sudo -u someone-else cat /path/dir/file 2>/dev/null && echo "LEAK - too permissive"
```

The negative control is the one people skip, and it is the one that catches the fix that worked
by making the data world-readable. On a dataset with any access conditions attached, "the
collaborator can read it" and "only the collaborator can read it" are different claims, and only
the second one is the requirement.

```bash
# nothing in the tree should be world-readable
find /path/dir -perm -o=r | head
```

## A sequence that works

1. Establish whether the target is a cache, and what home is.
2. Apply the grant **on the authoritative side**, with inheritance flags.
3. `chown` where needed; never `chmod` afterwards.
4. Wait out the revalidation interval, then read the ACL on the cache side.
5. Positive test as the intended identity.
6. Negative test as an unrelated identity, plus a world-readable sweep.
7. Create a file and confirm it inherited.
8. Write down that `chmod -R` on this tree revokes access, where the next person will see it.

Step 8 is not administrative tidiness. The failure it prevents arrives weeks later, with no
connection to anything anyone changed that day.

## Symptom against cause

| Symptom | Cause | Action |
|---|---|---|
| ACL correct, gone a minute later | Cache revalidated against authoritative home | set it on home |
| Grant vanished after a tidy-up job | `chmod` replaced the NFSv4 ACL | `chown` only; audit scripts for `chmod -R` |
| Old files accessible, new ones not | Entry lacks `fd` inheritance flags | re-add with `fd`, probe with `touch` |
| Directories show `+`, files do not | Tool wrote output without the ACL | re-apply to files; check files explicitly |
| Collaborator can read, so can everyone | Fixed by loosening the mode | negative control; `find -perm -o=r` |
| Works on one node, not another | Different mount, or stale metadata on that client | compare `findmnt`; check cache state |

**Decide which side is authoritative before you change anything.** On a caching filesystem that
decision has already been made for you, and every minute spent setting metadata on the
non-authoritative side is a minute spent writing something that will be overwritten.
