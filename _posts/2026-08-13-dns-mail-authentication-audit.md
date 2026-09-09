---
title: "DNS and mail authentication: a TXT answer is not a valid policy"
category: "Enterprise IT"
tags: ["DNS", "SPF", "DKIM", "DMARC"]
summary: "Check record content, sender alignment, and real message headers before declaring mail authentication healthy."
date: "2026-08-13"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

A DNS query returning text is not proof that the requested security record exists. Wildcards, stale records, and malformed content can make a superficial check look successful. Mail authentication needs both DNS inspection and an authorized message test.

## Inspect the exact names

For a domain you administer, replace `example.com` and the known DKIM selector:

```bash
dig +short TXT example.com
dig +short TXT _dmarc.example.com
dig +short TXT selector1._domainkey.example.com
dig +short TXT deliberately-unused-label.example.com
```

The last query helps identify a wildcard response. An answer identical to the apex TXT content at an unrelated name deserves investigation. Confirm against authoritative nameservers and parse the actual policy rather than accepting any nonempty answer.

## Separate the mechanisms

SPF authorizes sending infrastructure for the envelope identity. DKIM associates a cryptographic signature with a signing domain. DMARC evaluates alignment with the visible From domain and publishes handling/reporting policy. The primary specifications are [SPF, RFC 7208](https://www.rfc-editor.org/rfc/rfc7208), [DKIM, RFC 6376](https://www.rfc-editor.org/rfc/rfc6376), and [DMARC, RFC 7489](https://www.rfc-editor.org/rfc/rfc7489).

Consult current provider guidance and subsequent standards updates when implementing. This article's inspection method does not depend on copying a universal TXT record.

## Inventory legitimate senders

List the primary mail provider, billing system, CRM, website forms, and any other service sending as the domain. Record the actual envelope and signing domains from message headers. A vendor's generic setup page cannot establish which identity your account is currently using.

Remove stale authorizations through a reviewed change after confirming they are no longer needed. Do not tighten policy blindly: an overlooked legitimate sender can be rejected along with unwanted mail.

## Test with real headers

Send an approved test message from each legitimate route to a controlled mailbox. Inspect Authentication-Results, the visible From address, envelope identity, and DKIM signing domain. Confirm alignment and final delivery.

A website form displaying a thank-you message does not prove it sent mail. Verify that the receiving mailbox actually contains the message and that the sender identity is what the design intended.

## Roll policy out with evidence

Begin with an inventory and reporting workflow, review legitimate failures, and adopt stricter handling according to the organization's risk decision. Retain an explicit rollback and propagation plan. DNS caching means different receivers can observe different states during a change.

## Keep checks semantic

The automated check should validate policy syntax, uniqueness where required, record type, and the relationship between DNS and observed message authentication. It should report lookup errors as incomplete evidence, not absence or success.

Repeat after adding a SaaS sender, changing mail providers, or replacing the website's form handler. Domain authentication is a maintained dependency of business communication, not a one-time DNS task.
