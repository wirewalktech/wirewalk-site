---
title: "Offboarding: disabling the directory account is one step"
category: "Identity"
tags: ["Active Directory", "Microsoft Entra", "SSH", "Tokens"]
summary: "Test existing sessions and independent credentials as well as new sign-ins."
date: "2026-01-09"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

An employee's directory account can be disabled while an application session, SSH key, or API token remains usable. Offboarding is an access-removal workflow across systems, not a single identity-console action.

## Inventory the access forms

Record the person's interactive accounts, privileged identities, application roles, SSH credentials, API tokens, and delegated access. Include services they own so that access removal does not silently stop a business process.

Do not record secret values in the inventory. Store credential identifiers, owning systems, scopes, and rotation procedures.

## Separate new access from existing access

Microsoft documents that Entra token and application-session behavior can produce a delay between revocation and effective loss of access. Application-issued sessions may require application-side handling. See [Microsoft's access-revocation guide](https://learn.microsoft.com/en-us/entra/identity/users/users-revoke-access).

Use a test identity to establish what happens in your application estate:

| Access form | Validation |
|---|---|
| New SSO login | Denied after the intended control takes effect |
| Existing browser session | Ends within the documented interval/workflow |
| API token | Revoked or replaced at its issuing system |
| SSH key or certificate | No longer authorizes a new session |
| Active server session | Handled by the approved session procedure |

A failed new login says nothing about a browser window already open elsewhere.

## Handle SSH independently

Inspect central key or certificate issuance and local authorized-key paths. OpenSSH supports multiple authorization mechanisms, documented in [sshd_config](https://man.openbsd.org/sshd_config). Removing one visible key file is incomplete if another source still grants access.

A terminated employment relationship is not a reason to delete application data indiscriminately. Preserve records and transfer ownership according to the organization's retention and business procedures. Keep operational ownership separate from the individual's access rights.

## Rehearse a full departure

Create a synthetic user with representative access and an active application session. Run the offboarding checklist in a test scope. Record each system's completion time and the actual result of attempting access afterward.

Include a long-lived credential issued outside SSO. This catches a common design gap: the central identity system does its job while an independent service continues to trust an older credential.

## Make exceptions visible

Some departures require temporary continuity for scheduled tasks or shared business records. Replace personal ownership with an appropriate service identity or named successor. An exception should specify its purpose, expiry, and approving owner; leaving a personal account active indefinitely is not a migration strategy.

## Acceptance evidence

Keep the systems covered, access attempts, revocation timestamps, unresolved dependencies, and ownership transfers. Report incomplete items explicitly. “Account disabled” is a valid fact, but it is not a defensible summary of the entire access state.

Review [service-account lifecycle](/writing/vault-service-account-lifecycle/) to reduce the number of workflows tied to personal credentials before the next departure.
