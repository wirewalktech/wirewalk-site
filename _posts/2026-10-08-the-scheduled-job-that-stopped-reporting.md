---
title: "The scheduled job did not stop running, it stopped reporting"
category: Operations
tags: ["cron", "systemd timers", "Linux", "Monitoring", "Automation", "Backups", "Observability"]
summary: >-
  A cron job that redirects its own output has disabled the only notification
  channel cron has. Add a second copy of the crontab that nobody is reading and
  you have a job whose behaviour cannot be deduced from its configuration.
description: "Why cron MAILTO goes silent when a script redirects its own stdout and stderr, how stale drop-in crontabs keep running, and how to make a scheduled job prove it ran."
date: "2026-10-08"
last_reviewed: "2026-10-17"
series: "HPC and AI infrastructure engineering"
---

Scheduled work fails quietly more often than anything else in an estate, because the mechanism
that was supposed to tell you is usually the thing that broke. Three mechanisms, each of which
produces a job whose real behaviour cannot be read off its configuration.

## 1. The script that silences its own notifications

cron's notification model is simple and entirely output-driven: **if a job writes anything to
stdout or stderr, cron mails that output to `MAILTO`.** Silence means success. There is no exit
status handling, no retry, no alert — output or nothing.

So a script whose first act is to redirect its own output has turned the notifier off:

```bash
#!/bin/bash
exec >> /var/log/replication.log 2>&1      # cron will now never have anything to mail
```

This is a sensible thing to want — you do want a log — and it is usually added long after the
cron entry, by someone who is not thinking about cron. The job then fails every night for
months, writing its failure faithfully into a log file nobody opens, and `MAILTO` stays quiet
because quiet is what success looks like.

The fix is to put the condition in the **crontab line**, where cron can see it:

```cron
30 3 * * * root /usr/local/sbin/replicate.sh || echo "replicate.sh FAILED rc=$? on $(hostname)"
```

Now a non-zero exit produces output, and output produces mail. The script keeps its log; cron
regains its channel. Same idea for a timer, via `OnFailure=`:

```ini
[Unit]
OnFailure=notify-failure@%n.service
```

A related subtlety: `set -e` plus a pipeline means the exit status is the **last** command's,
so `mmsomething | tee log` exits zero when the first element fails. `set -o pipefail` or
explicit status checks, or the `||` above never fires.

## 2. The configuration you are reading is not the configuration in force

`/etc/cron.d` is a drop-in directory and cron reads **every** file in it. Which means a
superseded copy left beside the current one is still a live crontab.

The failure shape: someone pauses a nightly job by commenting out its line, and the job keeps
running on schedule. Reading the current file shows a commented-out, disabled job. The job is
driven by `replication.cron.bak-20260812`, sitting in the same directory, containing the
uncommented version — and if that copy ends its line with `>/dev/null 2>&1`, it is also
invisible to `MAILTO`.

You cannot deduce this from the file you edited. You have to ask the directory:

```bash
# every active line cron will actually act on, from every file
grep -rhE '^[^#[:space:]]' /etc/cron.d/ /etc/crontab 2>/dev/null | sort
for u in $(cut -d: -f1 /etc/passwd); do crontab -l -u "$u" 2>/dev/null | sed "s/^/$u: /"; done
```

And then verify against what the daemon reports doing, which is the only authority:

```bash
journalctl -u crond --since -25h | grep CMD | sort | uniq -c | sort -rn
```

If a command appears in the journal that does not appear in your inventory, you have found a
file you did not know about. If a command appears twice an hour and the configuration says
once, there are two files.

## 3. The unit that reports enabled and does nothing

`systemctl is-enabled` answers a question about symlinks, not about effect. The common way to
get a unit that is enabled, exits successfully, and accomplishes nothing persistent:

```ini
[Service]
Type=oneshot
ExecStart=/bin/mount --bind /gpfs/scratch /scratch
ExecStop=/bin/umount /scratch
```

Without `RemainAfterExit=yes`, a `Type=oneshot` service is considered **inactive** the moment
`ExecStart` returns — and systemd then runs `ExecStop`, because the unit is transitioning out of
active. The bind mount is created and immediately removed. `systemctl start` returns success;
`is-enabled` says enabled; the mount is not there.

```ini
[Service]
Type=oneshot
RemainAfterExit=yes
```

The check that catches it is not `is-enabled`, it is asserting the intended end state:

```bash
systemctl start scratch-bind.service
findmnt --target /scratch >/dev/null && echo present || echo "ABSENT - unit ran, nothing persisted"
```

## Make the job prove it ran

The common thread: every one of these is a job whose status is inferred rather than observed.
The cure is for each scheduled job to leave evidence that an independent check can read, and
for something to alert on the **absence** of that evidence.

A small, durable pattern:

```bash
# at the end of a successful run
STAMP=/var/lib/jobstate/replicate
printf '%s rc=0 bytes=%s\n' "$(date -Is)" "$BYTES" > "$STAMP"
```

Then publish staleness as a metric and alert on it. For a host already running node_exporter,
the textfile collector is the cheapest route:

```bash
printf 'job_last_success_timestamp_seconds{job="replicate"} %s\n' "$(date +%s)" \
  > /var/lib/node_exporter/textfile_collector/replicate.prom.$$ \
  && mv -f /var/lib/node_exporter/textfile_collector/replicate.prom.$$ \
           /var/lib/node_exporter/textfile_collector/replicate.prom
```

```promql
time() - job_last_success_timestamp_seconds{job="replicate"} > 93600
```

Three properties make this worth the ten lines. It is **positive evidence** — written only on
success, so it cannot be produced by a crashed run. It **detects not-running**, which
output-driven notification structurally cannot: a job that never starts produces no output and
therefore no mail. And it is **readable by something other than the job**, which is the only way
to escape the trap where the failing component is also the reporting component.

## Checking a schedule you have inherited

Six commands, in the order that finds things fastest:

1. `journalctl -u crond --since -25h | grep CMD` — what actually ran.
2. `grep -rhE '^[^#[:space:]]' /etc/cron.d/ /etc/crontab` — what is configured, from every file.
3. `ls -la /etc/cron.d/` — look for `.bak`, `.orig`, `~`, dated copies.
4. `systemctl list-timers --all` — the other scheduler, often forgotten entirely.
5. `grep -l 'exec *>' /usr/local/sbin/*` — scripts that have silenced themselves.
6. For each job: where is its evidence of success, and what alerts on the absence of it?

Question 6 is the one that usually has no answer, and it is the one that matters.

## Symptom against cause

| Symptom | Cause | Check |
|---|---|---|
| Job failing for weeks, no mail | Script redirects own stdout/stderr | `grep 'exec *>'`; move the test into the crontab line |
| "Paused" job still running | Second crontab in `/etc/cron.d` | `ls -la /etc/cron.d/`, journal CMD lines |
| Runs twice per schedule | Duplicate drop-in files | journal `uniq -c` |
| Unit enabled, effect absent | `Type=oneshot` without `RemainAfterExit` | assert end state, not `is-enabled` |
| Pipeline failure reported as success | Exit status of a pipeline is the last element | `set -o pipefail` |
| Nobody noticed for months | Nothing alerts on absence | success stamp + staleness alert |

**Silence is not a status.** A monitoring design where "no news is good news" cannot distinguish
a healthy job from a job that no longer exists, and a scheduled job that nothing checks is
indistinguishable from one that was never installed.
