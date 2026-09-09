---
title: "Kubernetes security: test admission, network policy, and storage access separately"
category: "Enterprise IT"
tags: ["Kubernetes", "NetworkPolicy", "Pod security"]
summary: "A namespace is an organizational boundary. Verify the controls that make it an access boundary."
date: "2026-06-02"
archive_date: true
published_on: "2026-09-09"
last_reviewed: "2026-09-09"
series: "Enterprise infrastructure and security"
---

A workload placed in its own namespace is easier to organize, but that fact alone does not prove isolation. Kubernetes admission controls, network policy, identities, and storage permissions each enforce a different part of the boundary.

## Define the workload's permitted behavior

Record whether the application needs privilege, host access, outbound network destinations, secrets, and persistent volumes. Start with actual requirements rather than cloning the permissions of an older deployment.

Kubernetes documents the Privileged, Baseline, and Restricted [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/). Choose and enforce an appropriate policy for the target release, with reviewed exceptions for infrastructure components that need additional privileges.

## Inspect the deployed objects

Using an authorized read-only Kubernetes context:

```bash
kubectl config current-context
kubectl get namespace example-app --show-labels
kubectl get networkpolicy -n example-app
kubectl get serviceaccount -n example-app
kubectl get rolebinding -n example-app
```

`example-app` is a placeholder namespace. Confirm the context before every administrative operation. These commands reveal configuration; they do not prove enforcement or effective authorization across all bindings.

## Validate network policy behavior

The Kubernetes [NetworkPolicy documentation](https://kubernetes.io/docs/concepts/services-networking/network-policies/) explains that enforcement depends on a supporting network implementation. The existence of a policy object is insufficient evidence.

In a lab namespace, run a permitted client and an unrelated client. Test the intended application port, required DNS resolution, and an outbound destination that should be denied. Include both ingress and egress expectations. Keep the tests harmless and restricted to the lab.

Do not assume policies are an ordered firewall rule list. Review their combination and selection semantics for the deployed implementation. A broad additional allow can change the intended boundary.

## Include the storage path

A pod with an authorized mount may still receive excessive filesystem permissions or access a shared dataset intended for another workload. For WEKA, PowerScale, VAST, or other CSI-backed storage, examine the storage-side identity and export/share policy as well as the Kubernetes objects.

Test a synthetic file through the application's actual container identity. Confirm both required access and denied access outside its scope. An admission policy cannot repair an overly broad storage authorization model by itself.

## Exercise rejected workloads

Use a disposable manifest that requests a prohibited capability and confirm admission rejects it. Then deploy a compliant workload and run its business transaction. Both results are necessary: a policy that rejects all work is not an acceptable application platform.

## Keep the evidence tied to the release

Record Kubernetes and network-plugin versions, policy objects, test identities, and expected-versus-observed results. Rerun after cluster upgrades and CNI or CSI changes. The accepted boundary belongs to the tested system, not to a YAML file considered in isolation.
