---
title: "Vault and service accounts: rotation must reach the running application"
category: "Identity"
tags: ["HashiCorp Vault", "Service accounts", "Secrets"]
summary: "Secret issuance, application renewal, and credential revocation are separate steps to verify."
date: "2026-02-02"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

A secret manager can issue a new credential while the application continues to use the old one from a configuration file or a connection pool. The security outcome depends on the consumer, not just the successful rotation task.

## Start with one service identity

Choose a noncritical application and record which database or API it accesses, the required privileges, how it receives credentials, and how it refreshes them. Separate deployment credentials from runtime credentials. A build system should not automatically inherit the application's production data access.

HashiCorp Vault's [database secrets engine](https://developer.hashicorp.com/vault/docs/secrets/databases) documents dynamic credentials and database-specific integrations. Supported plugins and credential behavior vary, so use the exact database and plugin documentation before implementation.

## Define the credential contract

| Property | Question |
|---|---|
| Scope | Which operations and resources are allowed? |
| Lifetime | How long may a credential remain valid? |
| Renewal | Who renews it and what happens on failure? |
| Revocation | How does the backend actually invalidate it? |
| Recovery | How does the application restart if Vault is unavailable? |

The contract should also identify where credentials might be copied: environment variables, logs, crash dumps, temporary files, or deployment artifacts. Moving the original into Vault does not remove existing copies.

## Test the consumer lifecycle

In a lab database, issue a least-privilege credential through the intended integration. Start the application, perform a permitted operation, and confirm that an out-of-scope operation is denied.

Allow renewal or rotation to occur through the actual application workflow. Confirm new connections use valid credentials and that the application handles the transition without accumulating connection failures. Then test expiry or revocation on the disposable identity and observe both new and existing connections according to the database's behavior.

Do not assume a revoked lease instantly terminates every established session. Establish the backend-specific outcome and document any additional response step.

## Protect bootstrap authority

The application needs an initial way to authenticate to Vault. Review that mechanism as carefully as the database credential. A permanent broad token embedded in an image can recreate the original problem at a more powerful layer.

Prefer workload identity methods supported by the environment, scope policies tightly, and verify the audit trail. Avoid displaying live secret values in routine validation output.

## Plan for service loss

Test a temporary loss of the secret-management path in a lab. Distinguish an already running application from a cold restart. Record the maximum acceptable interruption and the approved recovery path. Do not silently extend credentials indefinitely to make an availability test pass.

A completed implementation includes a successful permitted operation, denied excess access, observed rotation, tested revocation, and understood outage behavior. The existence of a Vault policy is only the configuration portion of that evidence.
