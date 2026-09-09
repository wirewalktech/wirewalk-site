---
title: "OpenSCAP reports: preserve the exceptions behind the score"
category: "Enterprise IT"
tags: ["OpenSCAP", "RHEL", "Hardening", "Audit"]
summary: "A scan result becomes useful evidence when the profile, content version, scope, and exceptions are retained."
date: "2026-05-09"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

A hardening score can improve because controls were implemented, because rules were excluded, or because the wrong profile was scanned. An assessment needs enough context to distinguish those outcomes.

## Pin the benchmark inputs

Record the operating-system release, OpenSCAP version, content package version, selected profile, tailoring file, and target identity. Retain the original machine-readable result along with any HTML report.

OpenSCAP documents configuration evaluation with XCCDF and OVAL and the use of profiles in its [tool overview](https://www.open-scap.org/tools/openscap-base/). A tool's ability to evaluate a benchmark does not certify the organization or establish that the benchmark fits the workload.

## Inspect before evaluating

On a lab host with OpenSCAP and the relevant content installed:

```bash
oscap -V
oscap info /usr/share/xml/scap/ssg/content/ssg-rhel9-ds.xml
```

The content path is an example for an installed RHEL 9 SCAP Security Guide package. Use the actual available data stream and read its listed profiles. Do not paste a profile identifier from a different release and assume it selected the intended controls.

Run a non-remediating evaluation first. Preserve both the process status and the report's semantic results. Evaluation errors, not-applicable rules, and failed rules mean different things.

## Review exceptions individually

For each excluded or accepted finding, record the rule, affected systems, operational reason, compensating control, owner, and review date. Avoid a blanket exception such as “HPC nodes need performance.” A specific setting may be necessary for one workload and unnecessary elsewhere.

| Finding state | Required follow-up |
|---|---|
| Failed and applicable | Remediate or approve a bounded exception |
| Not applicable | Verify why it does not apply |
| Evaluation error | Repair the assessment path |
| Excluded by tailoring | Review the tailoring decision |

A score without these states hides the information an auditor or operator needs most.

## Test remediation as a service change

Do not enable automatic remediation across an estate as the first experiment. Review proposed changes, apply a small subset to a pilot, and test application behavior and recovery access.

Some controls affect authentication, mounts, kernel behavior, or cryptography. Their operational consequences may not appear until a reboot or a new session. Include those lifecycle events in the pilot acceptance test.

## Compare like with like

When a later scan differs, compare content and profile versions before attributing the change to configuration drift. A revised benchmark can produce a different result on an unchanged host.

Keep a small evidence bundle for each assessment: input hashes, target inventory, results, exceptions, remediation record, and post-change checks. That supports a repeatable engineering review. It should never be shortened to an unsupported claim that the whole estate is “compliant.”

Related: [SELinux diagnosis](/writing/selinux-denials-without-disabling/) and [staged Linux maintenance](/writing/ansible-linux-patching-canaries/).
