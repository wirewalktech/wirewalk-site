---
title: "Six shell idioms that quietly corrupt a data pipeline"
category: Operations
tags: ["Bash", "Shell Scripting", "Linux", "Debugging", "Data Pipelines", "Automation", "IFS"]
summary: >-
  Each of these is valid shell that runs without error and produces a wrong
  answer: an empty field separator that looks like a tab, a grep that prints
  zero and fails, and an environment change discarded by a pipe.
description: "Bash pitfalls that fail silently in production scripts: empty IFS from command substitution, quoting through ssh, grep -c exit status, subshell environment loss, and pgrep matching itself."
date: "2026-09-02"
archive_date: true
published_on: "2026-10-17"
last_reviewed: "2026-10-17"
series: "HPC and AI infrastructure engineering"
---

The shell bugs that cost real time are not syntax errors. They are constructs that parse, run,
exit zero, and return something subtly wrong — so the failure surfaces three steps downstream as
bad data rather than as an error.

Six that have each cost more than an hour.

## 1. `IFS=$(printf '\t')` is an empty IFS

The intent is to split a TSV on tabs. The result splits on nothing.

```bash
IFS=$(printf '\t')      # IFS is now the EMPTY STRING
while read -r key value; do ...; done < data.tsv
```

Command substitution strips **trailing whitespace**, and a tab is whitespace. `$(printf '\t')`
is therefore `""`. With an empty `IFS`, `read` performs no field splitting at all: the entire
line lands in `$key` and `$value` is empty.

Downstream, every lookup keyed on `$key` misses, so a comparison script reports every object
missing — a dramatic, alarming, completely wrong result from a script with no errors in it.

```bash
IFS=$'\t'               # correct
```

With a caveat that produced the follow-on bug: `$'\t'` contains a single quote character in its
*source form*, so embedding it inside a single-quoted remote command terminates the quoting:

```bash
ssh host 'IFS=$'\t'; while read ...'      # the wrapper quote closes early
```

Workarounds exist (`$'\''` gymnastics, double quotes with escaping), and all of them are harder
to read than the thing that actually works: put the script in a file, copy it over, run it.

```bash
scp -q parse.sh host:/tmp/ && ssh host 'bash /tmp/parse.sh'
```

A useful habit for any loop over separated input — assert the split happened:

```bash
[ -n "$value" ] || { echo "field split failed on: $key" >&2; exit 1; }
```

## 2. `grep -c` prints `0` and exits non-zero

`grep -c` counts matches. With no matches it prints `0` **and exits 1**, because grep's exit
status reports whether anything matched, not whether the count succeeded.

So the defensive idiom produces two lines:

```bash
n=$(grep -c pattern file || echo 0)     # n is "0\n0" when there are no matches
[ "$n" -gt 0 ] && ...                   # integer expression expected
```

The `|| echo 0` fires *in addition to* grep's own `0`. Then an arithmetic test on a two-line
string fails with a syntax error, or worse, a `case` or string comparison silently takes the
wrong branch.

```bash
n=$(grep -c pattern file); n=${n:-0}    # grep already printed 0
# or
n=$(grep -c pattern file || true)
```

Same family: `wc -l < file` on a file with no trailing newline undercounts by one, and
`grep -q` is the right tool whenever you only need the boolean.

## 3. A pipe creates a subshell, and environment changes die in it

Any command whose effect is to modify the current shell's environment is lost when it runs in a
pipeline, because each element of a pipeline is a subshell.

This is how a module system gets wrongly accused:

```bash
module load gcc/13 | head -5        # loads in a subshell; PATH change discarded
gcc --version                       # still the system gcc
```

The conclusion drawn from that transcript — "the module is broken, it gives the wrong compiler"
— is wrong, and the test is what produced it. `module` is a shell function; piping it discards
exactly the thing it exists to do.

```bash
module load gcc/13
gcc --version
```

The same rule bites `read` in the famous form:

```bash
cat file | while read -r l; do n=$((n+1)); done
echo "$n"                 # empty: the loop ran in a subshell
while read -r l; do n=$((n+1)); done < file      # correct
```

And `shopt -s lastpipe` only helps in non-interactive shells with job control off, which is not
a thing to rely on in a script someone else will read.

## 4. `pgrep -f` matches the process doing the matching

`pgrep -f` matches against the full command line — including the command line of the shell that
is running your script, if the pattern appears in it.

```bash
pgrep -f "verify_objects" | xargs -r kill       # may include this very script
```

The script's own `bash /path/verify_objects.sh` contains the pattern. A kill list built this way
can include the session you are typing in. The symptom is a script that terminates itself
part-way through, intermittently, depending on how it was invoked.

```bash
pgrep -x -f "/usr/bin/python3 /opt/verify/worker.py" | grep -vx "$$"
# better: match the real binary, and exclude self explicitly
pgrep -f "$PATTERN" | grep -vx "$$" | grep -vx "$PPID"
```

Better still: have the workers write a PID file, or run them under a systemd scope and let
`systemctl kill` do it. String-matching process lists is a last resort.

## 5. `set -e` does not survive a pipeline, a subshell, or a condition

Three exemptions that make `set -e` much weaker than people assume:

```bash
set -e
false | tee out            # exit status is tee's: zero. Script continues.
f() { false; }; f || true  # the || suppresses it, as intended
if grep -q x file; then     # no exit here either, correctly
```

`set -o pipefail` fixes the first. The general point is that `set -euo pipefail` is a good
default and not a guarantee; anywhere the result matters, check it.

```bash
set -euo pipefail
mmapplypolicy ... -f "$OUT" || exit 1
[ -s "$OUT" ] || { echo "policy produced no records" >&2; exit 1; }   # the real check
```

That last line is the pattern worth taking away: tools that exit zero having done nothing are
common, and the only reliable test is on the artefact.

## 6. Locale makes `sort` and `comm` disagree between hosts

`comm` requires both inputs sorted the same way, and `sort` honours `LC_COLLATE`. Collect a list
from two machines with different locale settings and `comm` produces nonsense — most visibly, the
same line appearing in both "only in A" and "only in B", which is logically impossible and is
the tell.

```bash
ssh a 'find ... | sort' > a.txt      # sorted under a's locale
ssh b 'find ... | sort' > b.txt      # ... and b's
comm -23 a.txt b.txt                 # unreliable

LC_ALL=C sort -u a.txt > a.s; LC_ALL=C sort -u b.txt > b.s
LC_ALL=C comm -23 a.s b.s            # deterministic
```

Pin `LC_ALL=C` for any comparison, and re-sort locally rather than trusting remote sort order.

## Symptom against cause

| Symptom | Cause |
|---|---|
| Whole line in the first variable, rest empty | `IFS` set from command substitution — it is empty |
| "integer expression expected" on a count | `grep -c` printed 0 and `\|\| echo 0` printed another |
| Environment change has no effect | Ran inside a pipeline or subshell |
| Script kills itself | `pgrep -f` matched its own command line |
| Failure reported as success | Pipeline exit status, no `pipefail` |
| A line is "only in A" and "only in B" | Inputs sorted under different locales |
| Tool exits 0, output empty | Nothing asserted on the artefact |

The connective tissue: **the shell reports on command execution, not on intent.** Every one of
these runs correctly in the sense the shell cares about. If a step in a pipeline matters, assert
on what it produced — the row count, the field split, the file size — because the exit status is
answering a different question.
