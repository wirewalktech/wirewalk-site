---
title: "The green check that hides a broken result"
date: 2026-04-22 10:00:00 -0400
category: Operations
tags: [Verification, Monitoring, Shell, Automation, Testing]
summary: >-
  In a mature estate the dangerous failures are not crashes. They are the runs
  where exit status is zero, the log looks clean, the file exists and the
  contents are wrong. A taxonomy of how that happens, and the checking
  discipline that catches it.
---

A crash is a gift. It has a timestamp, a stack, a non-zero status and somebody's
attention. Crashes get fixed because they are impossible to ignore.

The failures that survive in a well-run estate are the other kind. The job exits
zero. The log ends with "completed". The output file is there, with the right
name, the right owner and a plausible size. Nothing in the monitoring turns
amber. And the contents are wrong — empty where they should be populated,
defaulted where you chose something else, stale where you expected fresh.

This class has no single cause. It has about seven, and they are mechanical
enough to be listed. What follows is the taxonomy, then the checking discipline
that actually catches them, which is narrower and more annoying than the one
most of us write by default.

The organizing claim: **a check that asserts on status rather than content is
not a check.** It is a record that something ran.

## The taxonomy

| Class | What the operator sees | Why the probe passes | The assertion that catches it |
|---|---|---|---|
| Error printed, status zero | An error line in a log nobody reads | Probe tests `$?` only | Compare stdout to an expected value |
| Plugin missing, schema intact | Correct headers, blank column | Header check passes | Assert a populated value for a case that must produce one |
| List parsed as one string | Silent fallback to a default | Config parses, service starts | Read the effective value back from the running process |
| Zero-byte index fetched | "Nothing to update" | Transfer tool exits zero | Assert a minimum size and a known marker in the content |
| Symlink to a path on another host | Module loads, variable empty | `module load` exits zero | Resolve the path and test the binary runs |
| Environment change inside a pipe | A working tool reported broken | Probe ran in a subshell | Set environment, then test in the same shell |
| Suite that has never failed | An unbroken run of green | Nothing has been injected | Prove each check fails on a deliberate fault |

Each row below gets its own section, because the mechanism matters more than the
symptom.

## Class one: the error that exits zero

Exit status is a convention, not a guarantee. Plenty of widely used tools print
a diagnostic and return success, either by design or by oversight.

`jq` is the honest case. A missing key is not an error in its data model — it is
`null`:

```
$ echo '{"a":1}' | jq -r '.b'
null
$ echo $?
0
```

A probe written as "run it, check the status, check that stdout is non-empty"
scores that as a pass. The string `null` is four bytes of non-empty output.
Downstream, a config generator writes `endpoint = null` into a file, the service
parses it, and you get whatever the service does with a nonsense endpoint.

`grep -c` is the inverse and catches people the other way:

```
$ printf '' | grep -c .
0
$ echo $?
1
```

It prints something (`0`) and returns failure. A probe keying on status calls
that a failure when the count is the answer you wanted; a probe keying on "is
there output" calls it a pass. Neither is reading the number.

The most expensive member of this family is HTTP. `curl` treats an HTTP error
response as a successful transfer, because from its point of view it was one:

```
$ curl -s -o index.json -w 'http=%{http_code}\n' https://example.com/api/index.json
http=404
$ echo $?
0
$ ls -l index.json
-rw-r--r-- 1 svc svc 559 Apr 22 09:14 index.json
```

The file exists. It is 559 bytes. It is an HTML error page. Every "the file was
created and is non-empty" check passes. `curl --fail` suppresses the body on a
4xx or 5xx and exits non-zero, which is what you want in a script;
`--fail-with-body` (curl 7.76 and later) does the same but keeps the body if you
need it for the log. Neither is the default, and the default is what ends up in
automation written in a hurry.

One caveat, because it bites checks that are too specific. The documented exit
code for `--fail` is 22, and over HTTP/1.1 that is what you get. Over HTTP/2 the
same 404 can surface as 56 instead, because curl tears the stream down and
reports a receive error rather than an HTTP one:

```
$ curl -s --fail -o /dev/null https://example.com/api/index.json ; echo $?
56
$ curl -s --http1.1 --fail -o /dev/null https://example.com/api/index.json ; echo $?
22
```

That pair is from curl 8.7.1, and I would treat the specific code as
build- and version-dependent rather than a rule — which is exactly the point.
Test `--fail` for non-zero, not for 22. A check written as `[ $? -eq 22 ]` is
itself a member of this article's taxonomy: it goes green on the day the
negotiated protocol, or the packaged curl, changes under it.

The general fix is not to distrust exit codes. It is to stop treating them as
the only evidence. Ask for the value, state what you expect, compare.

```
got=$(jq -r '.endpoint // empty' config.json)
[ "$got" = "https://collector.internal:8443" ] || {
  echo "endpoint mismatch: got [$got]" >&2; exit 1; }
```

That check can fail for a reason other than the process crashing, which is the
only property that makes it a check.

## Class two: the plugin that does not load

This is the one that has cost me the most time, because the output looks
completely normal.

Many tools declare their output schema separately from the code that populates
it. The formatter knows the column is called `MaxRSS`. Whether anything ever
writes a number into `MaxRSS` depends on a collector, a plugin or an accounting
module that may not be configured at all. When it is not, you do not get an
error. You get the column, with nothing in it.

Slurm's accounting is the canonical example. Ask for per-job memory:

```
$ sacct -j 1847221 --format=JobID,JobName,Elapsed,MaxRSS,AveCPU
JobID           JobName    Elapsed     MaxRSS     AveCPU
------------ ---------- ---------- ---------- ----------
1847221         run.sh     02:14:07
1847221.bat+      batch    02:14:07     8412K   02:11:53
1847221.0        python    02:13:44  41235280K  02:11:40
```

Now the same query with `-X`, which restricts output to allocation records:

```
$ sacct -X -j 1847221 --format=JobID,JobName,Elapsed,MaxRSS,AveCPU
JobID           JobName    Elapsed     MaxRSS     AveCPU
------------ ---------- ---------- ---------- ----------
1847221         run.sh     02:14:07
```

`MaxRSS` and `AveCPU` are gathered per step and stored on step records. The
allocation record has the columns and no values. A reporting script written
around `sacct -X` — a reasonable choice, since it gives one row per job — will
produce a memory report for the whole fleet in which every single job used no
memory. The header row is correct. The CSV parses. The chart renders. It is
entirely empty of information and looks like a finding.

The same shape occurs with a metrics exporter whose collector throws. The
exporter keeps serving `/metrics`; the failed collector's series are simply
absent. Any alert of the form `rate(thing_total[5m]) > 0` on a series that no
longer exists evaluates against an empty vector and never fires. The alert is
not firing and the thing it watches is unmonitored, and those two states are
indistinguishable on the dashboard. That is what `absent()` and
`absent_over_time()` are for, and why a rule that watches a metric should
usually be paired with a rule that watches for the metric's disappearance.

The assertion that catches the whole family is the same: **pick a case that must
produce a populated value, and assert on the value.** Not on the header, not on
the row count, not on the file size.

```
# a job you know allocated real memory; --noconvert keeps every value in K,
# so you are not comparing 8412K against 39.33G as strings
rss=$(sacct -n -j "$JOB" --format=MaxRSS -P --noconvert \
      | tr -d 'K ' | grep -E '^[0-9]+$' | sort -n | tail -1)
[ -n "$rss" ] && [ "$rss" -gt 1000 ] || {
  echo "accounting returned no MaxRSS for a job that used memory" >&2; exit 1; }
```

Two details in that snippet are load-bearing, and both are easy to get wrong in
a way that leaves the check passing. `--noconvert` matters because newer Slurm
renders large values in human units — a `sort -n` over a mixture of `8412K` and
`39.33G` puts the small number last. And the `grep -E '^[0-9]+$'` matters
because step records without a value emit a blank line: strip newlines along
with the `K` (`tr -d 'K \n'`, which is the form that comes naturally) and every
row concatenates into one integer.

```
$ printf '8412K\n41235280K\n\n' | tr -d 'K \n' | sort -n | tail -1
841241235280
```

That number is larger than any threshold you would set, so the check passes
forever, on any input, including no input at all.

### The interpretation that is wrong

A worked example, because this is where the trap closes.

A CPU-efficiency report built on `sacct` produced a fleet average of exactly
1.00. Every user, every partition, every month. The obvious reading is a
perfectly tuned estate. The correct reading is that the two quantities being
divided are the same quantity.

`CPUTimeRAW` is allocated CPU time: elapsed seconds multiplied by allocated
cores. It is not consumed CPU time. Divide `CPUTimeRAW` by itself, or by any
other allocation-derived figure, and you get 1.0 by construction, for every job
that has ever run. The consumed figure is `TotalCPU` (system plus user), and it
lives on step records — so the "one row per job" convenience of `-X` gives you
`TotalCPU` of zero, and an efficiency of 0.00 for everything. Two different
wrong answers, each uniform enough to look like a real property of the fleet.

```
# wrong: always 1.00 — CPUTime is CPUTimeRAW in a different notation
sacct -X -a -S 2026-03-01 --format=JobID,CPUTimeRAW,CPUTime -P

# workable: consumed over allocated, steps included
sacct -a -S 2026-03-01 --format=JobID,TotalCPU,CPUTimeRAW -P
```

Mind the units when you divide those two. `CPUTimeRAW` is an integer count of
CPU-seconds; `TotalCPU` is a formatted duration, `[DD-]HH:MM:SS[.mmm]`. Divide
the string by the integer without parsing it and you will get a number — a
small, uniform, entirely fictitious one — which is the same failure this section
is about, arrived at one layer further down.

Uniformity is the signal. A real efficiency distribution on a shared cluster is
wide and messy, and the mean lands somewhere below half — I would treat
roughly 30 to 60 percent as the plausible band for a general-purpose fleet, and
I am giving that as a band rather than a figure because it depends heavily on
the workload mix and I have no basis for a tighter claim. What I am confident
about is the mechanism: if a derived metric is the same for every row, suspect
the arithmetic before you believe the estate.

## Class three: the list that is one string

Configuration parsers disagree about lists. Some split on whitespace, some on
commas, some take the whole line, and some accept either and quietly prefer the
wrong one. When a list is read as a single literal, it usually matches nothing,
and "matches nothing" is frequently indistinguishable from "not configured" —
which means a fallback to a default you did not choose.

The shell version is the one everyone has written:

```
$ L="mlx5_0 mlx5_1"
$ for p in "$L"; do echo "iter: [$p]"; done
iter: [mlx5_0 mlx5_1]
```

One iteration, one token containing a space, and any lookup keyed on it fails.
Unquoted it splits into two; quoted it does not. Both are correct for some
purpose, and the difference is invisible in the log because the loop body ran
and exited zero.

The config-file version is more insidious because the file passes validation.
OpenSSH's server config, for most keywords, uses the first value obtained and
ignores later ones. `sshd -t` reports the file is fine. `systemctl reload sshd`
succeeds. Your carefully placed directive at the bottom of the file does nothing
at all, because something 200 lines above set it first — often a vendor-shipped
include you did not write. The only reliable check is to ask the running daemon
what it actually believes:

```
# run as root; sshd -T reads the host keys
# sshd 9.8 and later ship as a split binary, but -T still lives on sshd itself
$ sudo sshd -T | grep -i '^ciphers'
ciphers chacha20-poly1305@openssh.com,aes128-ctr,aes192-ctr,aes256-ctr
```

`sshd -T` prints the effective configuration after all parsing and includes. The
file is what you wrote; `-T` is what is true.

One qualification, because it is the reading people get wrong: bare `sshd -T`
prints the configuration for a connection that matches no `Match` block. If the
directive you care about lives inside a `Match Group` or `Match Address`, plain
`-T` will not show it and you will conclude, wrongly, that it never took. Supply
the connection you are asking about:

```
$ sudo sshd -T -C user=svc,host=jump.example.com,addr=203.0.113.10 | grep -i '^permitrootlogin'
```

The output is the effective value *for that connection*. There is no single
effective value for a config with `Match` blocks in it, and a check that assumes
there is will be right for most users and quietly wrong for the ones the block
was written for.

The general form: where a service distinguishes between the file it was given
and the configuration it is running, the effective-value output is the only
thing worth asserting on, and you must ask it about the specific case you care
about. Where a service offers no such output, read the value back through
whatever interface it does expose — a status command, an admin socket, an API —
and compare it to the value you intended, in writing, in the check.

## Class four: the zero-byte index

A package index, a manifest, a rule feed and a firmware catalog all share a
property: when they arrive empty, the consuming tool reports that there is
nothing to do.

```
$ curl -s -o /var/cache/feed/index.json -w 'http=%{http_code} size=%{size_download}\n' \
    https://feeds.example.com/v2/index.json
http=200 size=0
$ echo $?
0
$ ls -l /var/cache/feed/index.json
-rw-r--r-- 1 root root 0 Apr 22 03:00 /var/cache/feed/index.json
$ ./apply-feed --index /var/cache/feed/index.json
0 entries loaded, 0 applied, 0 errors
```

Three zeros and a clean exit. Read it out loud: nothing to apply, so nothing was
applied, so no errors. That is a correct description of a broken pipeline.

Note what that transcript is and is not, because the failure modes here do not
rank the way intuition ranks them. It is a 200 with an empty body — a
half-deployed origin, a proxy serving a truncated cache entry, a signing step
that produced nothing. `--fail` does not save you, because there is no HTTP
error to fail on: the transfer genuinely succeeded and what succeeded was
nothing.

The counter-intuitive part is which failure is worse for the file on disk. A
transport failure is the gentle one — curl exits non-zero and leaves an existing
destination untouched, so the last good copy survives:

```
$ echo "PREVIOUS GOOD CONTENT" > index.json
$ curl -s -o index.json https://feeds.example.invalid/v2/index.json ; echo $?
6
$ cat index.json
PREVIOUS GOOD CONTENT
```

An HTTP error without `--fail` is the destructive one. The transfer succeeds, so
curl writes, and the error page lands on top of the only good copy you had:

```
$ curl -s -o index.json https://example.com/api/index.json ; echo $?
0
$ ls -l index.json
-rw-r--r-- 1 root root 559 Apr 22 03:00 index.json
```

Adding `--fail` restores the gentle behavior — non-zero status, destination
left alone. Which reframes `--fail` from a tidiness flag into a data-protection
one: without it, every scheduled fetch is one origin misconfiguration away from
overwriting a good cache with an error page, at three in the morning, exiting
zero.

The reason this survives is that "no changes" is also the normal steady state.
On most days the honest answer genuinely is "0 applied". A check that only
alarms on errors will never distinguish "we are current" from "we are blind",
and the second state can persist for months.

Two assertions, both cheap:

```
# 1. minimum plausible size, not merely non-empty
# (GNU coreutils; on BSD/macOS the equivalent is stat -f %z)
sz=$(stat -c %s /var/cache/feed/index.json)
[ "$sz" -ge 4096 ] || { echo "index implausibly small: ${sz}B" >&2; exit 1; }

# 2. a structural marker, not just bytes
jq -e '.entries | length > 0' /var/cache/feed/index.json >/dev/null || {
  echo "index parsed but contains no entries" >&2; exit 1; }
```

And one more that is worth the trouble on anything time-sensitive: assert on the
age of the content, not the age of the file. Any transfer that opens the
destination before it knows the result — a 200 that dies half way through the
body, an error page written over a good cache — leaves you a fresh mtime over
bytes that are stale, partial or wrong. `find -mtime` is then measuring when
something was written, not when it was current. If the payload carries a
generation timestamp, compare that instead, and treat the file's own mtime as
evidence of nothing but write activity.

## Class five: the symlink that resolves nowhere

Shared software trees accumulate links. A module file or a wrapper script points
at `/opt/apps/tool/current`, `current` points at a release directory, and at
some point a release directory is moved, or the link is created on a build host
against a path that only exists there.

The link itself is not broken in any way the filesystem will tell you about.
`ln -s` will happily create a link to a path that does not exist. `ls` shows it.
And the module that consumes it does this:

```
prepend-path PATH    $prefix/bin
prepend-path LD_LIBRARY_PATH $prefix/lib64
```

where `$prefix` was computed by resolving the link. If the resolution produced
an empty string, `PATH` gains the entry `/bin` and `LD_LIBRARY_PATH` gains
`/lib64`. Both are real directories. Neither errors. `module load` exits zero,
`module list` shows the module loaded, and the binary you wanted is not on the
path — so you get the system's version, silently, at a different version than
the one the module claims.

The distinguishing commands:

```
$ ls -l /opt/apps/tool/current
lrwxrwxrwx 1 root root 33 Feb 11 16:02 /opt/apps/tool/current -> /build/stage/opt/apps/tool/3.11.2

$ readlink -e /opt/apps/tool/current
$ echo $?
1
```

`readlink -e` requires every component of the resolved path to exist and prints
nothing when it does not. For a check, that is the flag you want.

`readlink -f` is the one usually reached for, and the difference is worth
spelling out because the obvious summary of it is wrong. `-f` is not "the same
but it does not check". It requires every component *but the last* to exist. So
its behavior splits by which part of the target went missing:

```
# release directory pruned; the parent is still there → -f is happy, -e is not
$ readlink -f /opt/apps/tool/releases/3.11.2
/opt/apps/tool/releases/3.11.2
$ echo $?
0
$ readlink -e /opt/apps/tool/releases/3.11.2 ; echo $?
1

# link written on a build host; /build/stage does not exist here at all
$ readlink -f /opt/apps/tool/current ; echo $?
1
```

Which means a check built on `-f` catches the build-host case and misses the
pruned-release case — and the pruned release is the one that happens on a
schedule. It fails in the direction that looks fine.

Both flags are GNU coreutils. BSD and macOS `readlink` has no `-e` at all, and
its `-f` does not behave like the GNU one, so a check that runs on a mixed
estate should use `test -e "$(readlink -f …)"` or simply
`[ -e /opt/apps/tool/current ]`, which follows the link and answers the question
directly.

The assertion is not "does the module load". It is "after loading, does the
thing run and say the right version":

```
module purge
module load tool/3.11.2
command -v tool | grep -q '^/opt/apps/' || { echo "tool not from /opt/apps" >&2; exit 1; }
tool --version | grep -q '3\.11\.2'     || { echo "wrong tool version" >&2; exit 1; }
```

Two lines, and they fail for the right reasons: wrong location, wrong version.

## Class six: the environment change inside a pipe

This one is the mirror image of the rest. Here the estate is fine and the check
is wrong, and the natural conclusion — "the module is broken" — sends you off to
rebuild something that was never damaged.

In bash, every element of a pipeline runs in a subshell by default. Anything it
does to the environment dies with it:

```
$ x=1
$ echo hi | { x=2; }
hi
$ echo "x=$x"
x=1
```

"By default" is doing real work in that sentence, and this is the one place in
the article where the portable-looking rule is the unportable one. Bash exempts
the last stage if `lastpipe` is set and job control is off — the usual state of
a non-interactive script. zsh and ksh93 run the last stage in the current shell
unconditionally:

```
$ bash -c 'echo hi | read y; echo "bash y=[$y]"'
bash y=[]
$ zsh  -c 'echo hi | read y; echo "zsh y=[$y]"'
zsh y=[hi]
```

So the same validation script, interpreted by a different shell, produces a
different verdict about whether the estate is broken. Neither shell is wrong.
Pin the interpreter in the shebang and do not rely on which side of that line
you are on.

Now the operational version. A validation script wants to load a module and
capture the result:

```
module load fftw/3.3.10 | tee -a validate.log
echo "FFTW_DIR=[$FFTW_DIR]"
```

`module` is a shell function. Inside the pipe it runs in a subshell, sets its
variables there, and the subshell exits. `FFTW_DIR` is empty in the parent. The
script concludes the module sets nothing and reports a broken module. A second
engineer loads it by hand, it works perfectly, and the disagreement gets
attributed to "something about the environment".

The same mechanism hides real failures too:

```
$ bash -c 'false | true; echo "rc=$?"'
rc=0
$ bash -c 'set -o pipefail; false | true; echo "rc=$?"'
rc=1
```

Without `pipefail`, a pipeline reports the status of its last command only. Pipe
a failing producer into `tee` and the failure is gone. This is why so much
automation that pipes its output to a log has no idea when it failed.

`set -e` has its own blind spot in the same family:

```
$ bash -c 'set -eu; f(){ local v=$(false); echo "inside rc=$? v=[$v]"; }; f; echo after'
inside rc=0 v=[]
after
```

`local` is itself a command, and its exit status is the status of `local`, not
of the substitution inside it. `export`, `declare` and `readonly` swallow a
failure the same way, for the same reason:

```
$ bash -c 'set -eu; export v=$(false); echo "reached"'
reached
$ bash -c 'set -eu; declare v=$(false); echo "reached"'
reached
```

Split the declaration from the assignment and the same script stops:

```
$ bash -c 'set -eu; f(){ local v; v=$(false); echo "never reached"; }; f'
$ echo $?
1
```

One more in the same category, worth knowing because it appears in cleanup and
maintenance scripts — and worth stating carefully, because the usual version of
this folklore is half true. `find -exec cmd {} \;` returns zero even when every
invocation of `cmd` fails. `find -exec cmd {} +` does not: in GNU findutils a
non-zero invocation makes `find` itself exit non-zero.

```
$ find /tmp/fecheck -type f -exec false {} \; ; echo "semicolon rc=$?"
semicolon rc=0
$ find /tmp/fecheck -type f -exec false {} +  ; echo "plus rc=$?"
plus rc=1
```

The terminator, not the tool, decides whether failures propagate. `xargs` also
reports them — GNU `xargs` exits 123 if any invocation exits 1 to 125 — so if a
maintenance script's success depends on the command being run, use `+` or
`xargs`, and do not read anything into the status of a `\;` form.

The rule that covers all of it, for any harness you write:

```
set -Eeuo pipefail
```

plus: do not put environment-modifying commands in pipelines, and do not hide a
command substitution inside a `local`, `declare` or `export`.

## Class seven: the suite that has never failed

The last class is not a bug. It is the reason the other six survive.

A validation suite that has returned green on every run since it was written has
demonstrated exactly one thing: that it returns green. It has never been shown
to be capable of returning anything else. If half its assertions were deleted
tonight, tomorrow's run would be identical, and you would never know.

This is the same argument as the one for restore drills and for fire alarms with
a test button. A detector that has never been triggered under controlled
conditions is decoration until proven otherwise.

The fix is negative controls: for every check, construct the fault it claims to
detect, run the check, and require that it fails. Keep those injections in the
repository next to the suite, and run them on a schedule.

```
#!/usr/bin/env bash
# negctl.sh — prove each check can fail
set -Eeuo pipefail

fixtures=/var/lib/validate/fixtures
fail=0

expect_fail() {           # expect_fail <label> <cmd...>
  local label=$1; shift
  if "$@" >/dev/null 2>&1; then
    echo "NEGATIVE CONTROL DID NOT FIRE: $label"
    fail=1
  else
    echo "ok (failed as required): $label"
  fi
}

expect_fail "empty index rejected"      check_index "$fixtures/index.empty.json"
expect_fail "html error page rejected"  check_index "$fixtures/index.404.html"
expect_fail "truncated index rejected"  check_index "$fixtures/index.truncated.json"
expect_fail "blank MaxRSS rejected"     check_accounting "$fixtures/sacct.blank.csv"
expect_fail "dangling symlink rejected" check_prefix   "$fixtures/dangling-link"
expect_fail "wrong version rejected"    check_version  "$fixtures/tool-3.10.0"

exit "$fail"
```

The fixtures matter as much as the script. `index.404.html` should be a real
error page you captured, not one you typed; `sacct.blank.csv` should be real
output from a query that really did return blank columns. Saving the broken
artefact at the moment you find it is the cheapest thing in this article and the
one most often skipped.

There is a second-order benefit. Running the negative controls tells you when a
check has quietly stopped being able to fail — because someone loosened a
threshold, or because the tool's output format changed and a `grep` that used to
match now matches nothing and the surrounding `|| true` swallows it.

## The discipline, condensed

Four rules, in the order they pay off.

**Assert on content, not on status.** Exit zero means the process reached its
own idea of the end. It says nothing about the bytes it produced. Every check
should name a value it expects and compare.

**Write the expected value down in the check.** Not "non-empty", not "more than
zero rows" — the actual string, the actual minimum, the actual version. A check
that does not encode an expectation cannot detect a wrong answer, only a missing
one.

**Pick a case that must produce a populated result.** The whole plugin-shaped
failure class hides behind aggregate checks. One known job, one known file, one
known value, asserted exactly, is worth more than a thousand rows counted.

**Prove every check can fail.** If you cannot show the injected fault that turns
it red, it is not a check. Delete it or fix it, because leaving it there is
worse than having nothing — it produces the feeling of coverage without the
coverage.

And one habit underneath all four: when a number is uniform across every row, or
a report is empty on a day when it should not be, or a pipeline says "0 applied"
for the ninth week running, treat that as a finding about the measurement rather
than a finding about the estate. In my experience the uniform answer is wrong far
more often than it is right.

## What this does not cover

Nothing here detects a computation that is wrong in a plausible way — output
that is populated, well-formed and numerically incorrect. That needs a reference
result, a known-answer test or an independent implementation, and it is a
different and harder problem.

Nor does any of it help if the check and the thing being checked share a
dependency. A probe that reads the same broken index, or resolves the same
dangling link, or inherits the same empty variable, will agree with the system
perfectly. When you build a negative control, inject the fault as far upstream as
you can reach, and confirm the alarm travels all the way to the place a human
would actually see it. A check nobody reads is the same as a check that cannot
fail, arrived at by a different route.
