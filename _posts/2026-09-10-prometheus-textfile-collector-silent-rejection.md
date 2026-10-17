---
title: "One bad line discards the whole file: the Prometheus textfile collector"
category: Operations
tags: ["Prometheus", "node_exporter", "Textfile Collector", "Monitoring", "Grafana", "Observability"]
summary: >-
  The textfile collector parses a metrics file as a single unit. One misplaced
  TYPE declaration and node_exporter drops every series in the file, while the
  script that wrote it exits zero and reports success.
description: "Why node_exporter rejects an entire Prometheus textfile on one malformed line, how to detect it with node_textfile_scrape_error, and how to validate before publishing."
date: "2026-09-10"
archive_date: true
published_on: "2026-10-17"
last_reviewed: "2026-10-17"
series: "HPC and AI infrastructure engineering"
---

The textfile collector is the usual way to get custom metrics into Prometheus from a machine
that has no business running an HTTP service. A cron job writes
`/var/lib/node_exporter/textfile_collector/thing.prom`, node_exporter reads it on each scrape,
and the series appear alongside everything else.

The failure mode worth knowing about in advance: **the file is parsed as a unit.** If any line
in it is malformed, node_exporter does not skip that line. It rejects the entire file. Four
hundred perfectly good series disappear because the four hundred and first was wrong, and the
script that produced the file exits zero, because writing a file that will later be rejected
is not an error.

Dashboards go blank. Nothing alerts, because the alert was defined on a series that no longer
exists, and an expression over no data is not a breach — it is nothing at all.

## The rule that is easiest to break

Within one file, a metric's `# HELP` and `# TYPE` lines must appear **before** the first sample
of that metric, and `# TYPE` may appear only once per metric name. That sounds obvious until a
script grows by accretion: a new section is appended at the bottom, it declares a type for a
metric whose samples were already written higher up, and the file is now invalid.

```
# HELP repl_bytes Replicated bytes
# TYPE repl_bytes gauge
repl_bytes{fileset="a"} 12
repl_bytes{fileset="b"} 48
# TYPE repl_bytes gauge          <-- second declaration, file rejected
repl_bytes{fileset="c"} 7
```

The other common form is a declaration that arrives after samples because two functions each
emit "their own" block and the order they are called in changed.

## How to tell

node_exporter exposes its own verdict. Scrape it:

```bash
curl -s localhost:9100/metrics | grep node_textfile
```

```
node_textfile_scrape_error 1
node_textfile_mtime_seconds{file="repl.prom"} 1.7613e+09
```

`node_textfile_scrape_error 1` means at least one file in the directory failed to parse. It
does not say which, and it does not say why — but it is the difference between "the metric is
missing" and "the metric is being refused", and those have completely different fixes.

Two things follow from this that are worth building in:

- **Alert on `node_textfile_scrape_error > 0`.** It is one rule, it covers every custom metric
  on every host, and it is the only signal that distinguishes a rejected file from a metric
  nobody is writing.
- **Alert on staleness via `node_textfile_mtime_seconds`.** A file that stopped being updated
  parses perfectly and serves the same value forever. `time() - node_textfile_mtime_seconds >
  900` catches the writer dying, which the parse-error metric never will.

The exporter's log gives the line number, if you can get at it:

```bash
journalctl -u node_exporter --since -1h | grep -i textfile
```

## Validate before you publish, not after

The useful discipline is that the collector script should refuse to install a file it has not
checked. Write to a temporary file, validate, then move into place — the move is atomic, so a
scrape can never catch a half-written file.

```bash
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
generate_metrics > "$TMP"

validate() {
    awk '
    /^#[[:space:]]*(HELP|TYPE)[[:space:]]/ {
        kind=$2; name=$3
        if (kind=="TYPE") {
            if (name in typed)   { printf "line %d: duplicate TYPE for %s\n", NR, name; bad++ }
            if (name in sampled) { printf "line %d: TYPE after samples for %s\n", NR, name; bad++ }
            typed[name]=1
        }
        next
    }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
        # metric_name{labels} value  [timestamp]
        name=$1; sub(/[{ ].*$/, "", name)
        if (NF < 2)                   { printf "line %d: no value\n", NR; bad++ }
        else if ($NF !~ /^[+-]?([0-9.]+([eE][+-]?[0-9]+)?|NaN|[+-]?Inf)$/) {
            printf "line %d: value not a float: %s\n", NR, $NF; bad++ }
        sampled[name]=1
    }
    END { exit (bad>0) }' "$1"
}

if validate "$TMP"; then
    mv -f "$TMP" /var/lib/node_exporter/textfile_collector/repl.prom
    trap - EXIT
else
    echo "refusing to install malformed metrics file" >&2
    exit 1
fi
```

The part that matters more than the awk is the **negative control**. A validator that has never
rejected anything is indistinguishable from a validator that cannot reject anything. Feed it a
file you know is bad and confirm it says so:

```bash
printf 'x 1\n# TYPE x gauge\n' | validate /dev/stdin && echo "BUG: accepted a bad file"
```

If that line prints `BUG`, the check you were relying on was decorative.

## Three more traps in the same area

**Label churn creates series, it does not update them.** A label whose value is a path, a job
ID or a timestamp produces a new time series per value. The file stays small and valid while
the TSDB's cardinality climbs. Labels are for dimensions you will group by, not for data.

**Writing to the directory from more than one script.** Two writers, one filename, and you get
interleaved content that validates about half the time. One file per writer, named after the
writer.

**A counter that resets because the script restarts.** If you compute a counter from state that
is lost on reboot, `rate()` sees a reset and reports a spike or a gap. Either keep the state
durable, or publish it as a gauge and be honest that it is one.

## Symptom against cause

| Symptom | Likely cause | Command |
|---|---|---|
| All series from one file gone, others fine | Malformed line, whole file rejected | `curl -s localhost:9100/metrics \| grep node_textfile_scrape_error` |
| Series present but frozen | Writer died; file still parses | `node_textfile_mtime_seconds` |
| Series missing, no parse error | Writer never ran, or wrong directory | `ls -la` the collector dir; check the cron line |
| Metric appears then vanishes per scrape | Two writers, same filename | one file per writer |
| Query works in Grafana, alert never fires | Expression over absent data is not a breach | alert on `absent()` as well |

The general principle is the one that applies to every pipeline that transforms text into
state: **the component that writes is not the component that decides whether the write was
valid.** Exit zero from the writer tells you a file was produced. Only the reader's own error
metric tells you it was accepted.
