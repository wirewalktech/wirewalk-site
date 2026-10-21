---
title: "Directories that use everything in them, including your backup file"
category: "Enterprise IT"
tags: ["Linux", "Configuration Management", "PAM", "cron", "systemd", "Environment Modules", "Operations"]
summary: >-
  A whole class of Unix configuration is "every file in this directory counts".
  Edit one in place and leave a .bak beside it, and the backup becomes live
  configuration — displayed to users, parsed as a job, or loaded as software.
description: "Why editing config in place and leaving a .bak alongside it breaks drop-in directories like /etc/motd.d, /etc/cron.d and MODULEPATH, and where backups should go instead."
date: "2026-09-25"
last_reviewed: "2026-10-17"
series: "HPC and AI infrastructure engineering"
---

`cp file file.bak` before editing is such deeply ingrained practice that it does not get
thought about. It is also wrong in a specific and common situation: when the directory the file
lives in is a **drop-in directory**, where the consuming program's contract is "use every file
in here".

In that case the backup is not inert. It is a second live copy of the configuration — usually an
older one — and the program has no notion that one of these files is special.

## The contract, stated plainly

From `man 8 pam_motd`, on the directory used to assemble the login message:

> The /path/dirname.d directory is scanned and each file contained inside of it is displayed.

**Each file.** No extension filter, no exclusion of anything that looks like a backup. So a
login banner edited in place, with `userinfo.motd.bak-20261017` left beside it, prints twice —
the current text and the superseded text, concatenated, to every user who logs in. The file you
edited is correct. The thing users see is not.

The same contract, different consumer, with worse consequences: environment modules treats every
regular file under `MODULEPATH` as a loadable module.

```
$ module avail
matlab/2025a
matlab/2025a.bak-lnhint       <-- loads the PRE-EDIT modulefile
```

That entry is offered to users by tab completion and by `module avail`, and loading it applies
the old configuration. It is not a cosmetic blemish; it is a shadow copy of software
configuration that silently wins for anyone who selects it. Worse for debugging: a verification
script that resolves "the latest matlab" by sorting the directory listing will pick
`2025a.bak-lnhint`, test the old file, and report that the change did not take effect — sending
you after a bug that does not exist.

## The directories this applies to

Not exhaustive, but these cover most of it:

| Directory | Consumer | What a stray file does |
|---|---|---|
| `/etc/motd.d/` | `pam_motd` | printed to every user at login |
| `/etc/cron.d/` | cron | **parsed and run as a job** |
| `/etc/sudoers.d/` | sudo | grants or denies; `visudo -c` ignores files with a `.` in the name |
| `/etc/profile.d/` | login shells | sourced — only `*.sh` and `*.csh`, so a `.bak` is inert here |
| `/etc/yum.repos.d/` | dnf | an old `.repo.bak` is **not** read (needs `.repo`), but `.repo.orig` edits are |
| `/etc/systemd/system/*.d/` | systemd | only `*.conf`; other names ignored |
| `/etc/ld.so.conf.d/` | ldconfig | only `*.conf` |
| `/etc/NetworkManager/conf.d/` | NetworkManager | only `*.conf` |
| `MODULEPATH` trees | environment modules | every regular file is a module |
| `/etc/logrotate.d/` | logrotate | every file, unless `tabooext` excludes it |

The pattern to internalise is that the directories split into two groups: those that **filter by
extension** (`profile.d`, `*.d/*.conf` under systemd, `ld.so.conf.d`) where a `.bak` is harmless,
and those that **take everything** (`motd.d`, `cron.d`, `logrotate.d` modulo taboo lists,
`MODULEPATH`) where it is not. Guessing which is which is not a strategy; the manual page says,
and it is a two-minute check.

`/etc/cron.d` deserves singling out. A superseded crontab left in place keeps running. If you
"paused" a job by commenting out its line in the current file, and a `.bak-` copy of the
uncommented version is still sitting in the directory, the job continues on schedule and the
file you are reading says it should not. That is a genuinely difficult thing to diagnose from
the current configuration, because the current configuration is correct.

## Where backups should go

Three options, in order of preference:

**1. Out of the directory entirely.**

```bash
BK=/root/config-backups; mkdir -p "$BK"
cp -a /etc/motd.d/userinfo.motd "$BK/userinfo.motd.$(date +%Y%m%d-%H%M%S)"
```

**2. A hidden subdirectory, when the consumer skips dotted entries** — true for environment
modules, which ignores `.`-prefixed names. Preserve the relative path so a restore is a single
`mv`:

```bash
M=/usr/share/Modules/modulefiles
install -D "$M/matlab/2025a" "$M/.backups/matlab/2025a"
```

Verify the exclusion rather than trusting it. Drop a probe in and confirm it does not appear:

```bash
mkdir -p "$M/.backups" && echo '#%Module' > "$M/.backups/ZZPROBE"
module avail -t 2>&1 | grep -c ZZPROBE      # expect 0
rm -f "$M/.backups/ZZPROBE"
```

**3. Version control, and no backup file at all.** The reason the `.bak` habit exists is that
there is no other way back. Where the configuration is in a repository, there is, and the
cleanest drop-in directory is one that only ever contains live files.

One caveat on hidden subdirectories: put them where the **shared** copy lives. If a tree is a
mount point — a network or parallel filesystem mounted at a path whose parent is local disk — a
sibling backup directory created one level up is node-local, so your backups scatter across
whichever host you happened to run the edit on. Check with `findmnt` before choosing the
location.

## Verify the consumer's output, not your file

The general lesson is the one that makes this class of bug expensive: every check performed on
the file was green, because the file was right. The fault was in the directory, which nothing
was looking at.

So assert on what the consumer produces:

```bash
# how many files will pam_motd actually print?
ls -1 /etc/motd.d | wc -l                    # expect exactly 1

# does the module system offer anything it should not?
module avail -t 2>&1 | grep -c '\.bak'       # expect 0

# what does cron believe it has been told to run?
grep -rhE '^[^#]' /etc/cron.d/ | sort
```

And when you are checking whether an edit took effect, be careful that the probe itself does not
select the backup. Resolving "the newest version in this directory" by `ls | tail -1` is exactly
how a `.bak-` suffix gets tested instead of the real file.

## Symptom against cause

| Symptom | Cause | Check |
|---|---|---|
| Login banner shows old and new text | `.bak` in `/etc/motd.d` | `ls -1 /etc/motd.d` |
| A "paused" cron job still runs | Superseded file in `/etc/cron.d` | `grep -rhE '^[^#]' /etc/cron.d/` |
| `module avail` lists `*.bak*` | Backups under `MODULEPATH` | move to `.backups/`, verify with a probe |
| Edit appears to have no effect | Test resolved to the backup file | print the path the test used |
| Backups present on one node only | Backup dir on a local parent of a shared mount | `findmnt --target` |
| sudo rule ignored | Filename contains a `.` | rename; `visudo -c` |

**A directory is an interface.** If its contract is "everything in here", then writing a file
into it is a configuration change, whatever you intended by the filename.
