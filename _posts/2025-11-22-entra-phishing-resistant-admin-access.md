---
title: "Microsoft Entra admin access: require the authentication method you intend"
category: "Identity"
tags: ["Microsoft Entra", "FIDO2", "MFA"]
summary: "An MFA requirement and a phishing-resistant authentication requirement are not identical policies."
date: "2025-11-22"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
seo_title: "Microsoft Entra Admin Access: Phishing-Resistant MFA Tests"
description: "Test Microsoft Entra authentication strength, FIDO2 registration, recovery and policy exclusions for privileged access requiring phishing-resistant MFA."
---

An administrator may pass an MFA check using a method the organization did not intend to allow. If phishing resistance is the requirement, specify the acceptable authentication strength and test that weaker fallback methods are rejected.

## Inspect authentication strength

Microsoft Entra Conditional Access provides authentication strengths that constrain acceptable method combinations. Microsoft documents a policy for administrator roles using phishing-resistant MFA. See [the administrator policy guide](https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-admin-phish-resistant-mfa) and [how strengths are evaluated](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-strength-how-it-works).

Confirm current licensing, supported methods, tenant configuration, and dependencies before rollout. Do not assume a policy named “strong MFA” actually requires the intended methods.

## Prepare registration and recovery

Select a pilot group and ensure users have registered the approved authenticators before enforcement. Test an alternative recovery route that does not recreate the same failure dependency. Losing a device should not leave the only administrator unable to operate the tenant.

Microsoft's [emergency access guidance](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access) is the starting point for protecting and monitoring emergency accounts. Follow current requirements rather than copying an old blanket MFA exclusion.

## Test a policy matrix

| Scenario | Expected result |
|---|---|
| Pilot administrator with approved method | Access succeeds |
| Pilot administrator using a disallowed method | Required step-up or denial |
| Unregistered pilot administrator | Documented enrollment/recovery outcome |
| Emergency procedure | Authorized access and visible audit evidence |
| Ordinary user outside scope | Intended existing behavior |

Run report-only analysis where supported, then a controlled enforced pilot. Report-only results cannot establish that an application actually accepts the final login flow.

## Review exclusions as carefully as inclusions

List excluded users, groups, workloads, and applications. Give each exception an owner and review date. A broad exclusion for automation may accidentally cover interactive administrators if account types and group membership are poorly controlled.

Check the interaction with other Conditional Access policies. The effective result comes from the policy set, not the one screen currently being reviewed. Inspect sign-in details for the test session to confirm which controls applied.

## Protect the post-login path

Stronger authentication does not remove excessive privileges, insecure administrator workstations, or stolen active sessions. Keep privileged work separate from ordinary browsing and email, minimize standing authority, and document session-revocation procedures.

Keep sign-in evidence for allowed and denied attempts, together with the policy scope, exclusions and recovery test. Enrollment counts will not show whether the policy actually blocked a weaker method.

Next, examine [privileged SSH access](/writing/privileged-ssh-bastion-boundaries/) and [offboarding across sessions and tokens](/writing/offboarding-sessions-keys-tokens/).
