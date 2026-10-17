---
title: "Node-local state and the reimage that erases it"
category: "Enterprise IT"
tags: ["Provisioning", "Golden Images", "Configuration Drift", "HPC", "Base Command Manager", "Operations", "Automation"]
summary: >-
  A fix applied to a running node survives until that node is reimaged, and
  then it is gone with no event to connect the two. The decision that prevents
  it is knowing which changes are node-local and which live on shared storage.
description: "How to avoid losing configuration at reimage: classifying node-local versus shared state, why per-node image overrides defeat a category default, and verifying from the image path."
date: "2026-08-17"
archive_date: true
published_on: "2026-10-17"
last_reviewed: "2026-10-17"
series: "HPC and AI infrastructure engineering"
---

A node misbehaves, you fix it, you verify the fix, you move on. Eight weeks later the same node
shows the same fault. Nothing changed in between — except that the node was reimaged for a
kernel update, and the fix lived in its local filesystem.

This is the most reliably recurring class of operational loss in a provisioned estate, and
avoiding it is a classification question asked **before** the change, not a discipline applied
afterwards.

## Classify the change before making it

Every configuration change in a cluster lands in one of three places, and the place determines
what you have to do to make it durable.

| Where it lives | Survives reimage? | What durability requires |
|---|---|---|
| Node-local filesystem (`/etc`, `/var`, local units) | **No** | bake into the image, or manage it from config management |
| Shared filesystem (parallel FS, NFS-mounted app tree) | Yes | nothing — one edit reaches every node |
| Provisioning system's own database (node records, roles, kernel params) | Yes | commit it there, not on the node |

The practical test is a single command. If the path is a mount from shared storage, the change
is global and already durable:

```bash
findmnt --target /the/path -o SOURCE,FSTYPE,TARGET
```

This matters more than it sounds, because adjacent paths frequently differ. A software tree can
be a shared mount while its **parent directory is local disk** — so an edit one level up is
node-local even though everything below it is global. One cluster can have a tool tree on shared
storage where another has the same path on local disk, which is exactly how a procedure that
worked on one cluster silently fails on the next.

Things that are almost always node-local and get forgotten: `/etc/motd` and
`/etc/motd.d`, PAM stacks, sshd config, systemd units and drop-ins, `/etc/fstab`,
`/etc/security/limits.d`, cgroup and slice configuration, local firewall rules, node exporter
collectors in `/var/lib`, and anything written into `/etc/profile.d`.

Things that are usually shared: the application and module trees on a parallel filesystem, which
is why a module fix is a one-time edit and a PAM fix is a fleet operation.

## Per-node overrides defeat the category default

The trap that turns a correct bake into a no-op. Provisioning systems let you assign an image at
the **group or category** level, and then let individual nodes **override** it. Both are normal
and both are used.

So you bake your change into the category's image, verify the file is present in that image,
reboot the node — and the change is not there, because the node has its own image assigned and
the category default was never consulted.

Enumerate what each node actually resolves to, not what the category says:

```bash
for n in login001 login002 node041 node042; do
  printf "%-10s category=%-10s image=%s\n" "$n" \
    "$(cmsh -c "device use $n; get category" 2>/dev/null)" \
    "$(cmsh -c "device use $n; get softwareimage" 2>/dev/null)"
done
```

Then bake into **every image that is actually assigned**, plus the category default so that
future nodes inherit it. A fleet of four login nodes can easily be four distinct images.

The matching hazard in the other direction: a category's default image may be **shared with a
different class of machine**. If the login category's default image is the general compute
image, baking a login-specific change into it reaches every compute node too. Check what else
uses an image before writing to it:

```bash
cmsh -c "softwareimage use <image>; show" 2>/dev/null
cmsh -c "device list" | awk '{print $4}' | sort | uniq -c    # nodes per category
```

## Verify from the image, not from the copy

Writing into an image is a file copy into a directory tree, and file copies succeed in ways that
do not accomplish the goal — wrong path inside the tree, a stale file still present beside the
new one, the right content with the wrong mode.

So read back from the image path and assert on content:

```bash
IMG=/cm/images/login-2026-10
F=$IMG/etc/motd.d/userinfo.motd

install -m 644 -o root -g root ./userinfo.motd "$F"

# assertions, from the image tree
printf "  files in motd.d : %s (want 1)\n" "$(ls -1 $IMG/etc/motd.d | wc -l)"
printf "  legacy motd     : %s lines (want 0)\n" "$([ -s $IMG/etc/motd ] && wc -l < $IMG/etc/motd || echo 0)"
printf "  content marker  : %s (want >=1)\n"  "$(grep -c 'sbatch' "$F")"
printf "  mode            : %s (want 644)\n"  "$(stat -c %a "$F")"
```

The `files in motd.d` line is the one that catches the real mistake. Baking a new file while an
old one is still in a drop-in directory means the node boots with both, because that kind of
directory uses every file in it. An image is where those leftovers persist indefinitely.

## Make the live fix and the baked fix one operation

The reason fixes get lost is that applying them live and baking them are two separate acts, and
the second one is the one that gets skipped under time pressure. The fix is to make them the
same script, parameterised by target root:

```bash
apply() {           # apply "" for live, apply /cm/images/<img> for an image
  local R=$1
  install -D -m 644 ./userinfo.motd "$R/etc/motd.d/userinfo.motd"
  : > "$R/etc/motd"
  find "$R/etc/motd.d" -name '*.bak*' -exec mv -t "$R/root/motd-backups/" {} +
}

apply ""                                  # the running node
for i in /cm/images/login-*; do apply "$i"; done   # every image that provisions one
```

Run the same assertions against both roots. Then the question "is this durable" has a mechanical
answer rather than depending on whether anyone remembered.

## A reimage checklist

1. Which paths did I change? `findmnt --target` each one.
2. For node-local paths: which images provision this node, **including per-node overrides**?
3. Is any of those images shared with a different class of node?
4. Apply to the running node and to every image, from one script.
5. Assert on content read back from the image tree, not on the copy's exit status.
6. Confirm the drop-in directories in the image contain only what should be there.
7. Record which images were touched, so the next person updating one does not drop your change.

## Symptom against cause

| Symptom | Cause | Check |
|---|---|---|
| Fix gone after a kernel update | Node-local, never baked | `findmnt --target` before changing |
| Baked and verified, node still wrong | Node has a per-node image override | resolve per node, not per category |
| Change appeared on unrelated nodes | Image shared across classes | list devices per image before writing |
| Node boots with old and new config | Leftover file in a drop-in dir in the image | count files in the directory |
| Works on one cluster, not the other | Same path, local on one, shared on the other | compare `findmnt` output |
| Image file present, no effect | Wrong path inside the tree, or wrong mode | assert content and mode from the image |

**Durability is a property of location, not of effort.** The verification that matters is not
that the change was applied, but that it is stored somewhere a rebuild reads from.
