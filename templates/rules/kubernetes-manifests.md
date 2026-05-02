---
description: Write safe, production-grade Kubernetes manifests with resource limits, health checks, and security context.
scope:
  - "**/k8s/**/*.yml"
  - "**/k8s/**/*.yaml"
  - "**/manifests/**/*.yml"
  - "**/manifests/**/*.yaml"
  - "**/kustomize/**/*.yml"
  - "**/kustomize/**/*.yaml"
---

# Kubernetes manifests

Write Kubernetes manifests that are safe, predictable, and production-ready.

## Resource requirements

- Every container must define `resources.requests` and `resources.limits` for CPU and memory.
- Avoid `resources.limits.cpu` throttling in latency-sensitive services — set requests only and rely on node limits.
- Use `LimitRange` objects to enforce defaults at the namespace level.

## Health checks

- Every Deployment and StatefulSet must define `livenessProbe` and `readinessProbe`.
- Use `startupProbe` for slow-starting containers to prevent premature restarts.
- Liveness probes should target a dedicated health endpoint, not the main application endpoint.

## Security

- Never use `privileged: true` without documented justification.
- Set `runAsNonRoot: true` and `readOnlyRootFilesystem: true` in `securityContext`.
- Drop all capabilities and add back only those required: `capabilities: { drop: [ALL] }`.
- Avoid `hostNetwork: true`, `hostPID: true`, and `hostIPC: true`.
- Do not store secrets in plain Kubernetes `Secret` objects in version control; use sealed-secrets, SOPS, or external secrets.

## Image and update strategy

- Never use `:latest` or `:main` image tags; pin to a specific version or digest.
- Set `imagePullPolicy: IfNotPresent` for pinned tags; `Always` only for digest-pinned images.
- Use `RollingUpdate` strategy; set `maxUnavailable: 0` for zero-downtime deploys.
- Define `podDisruptionBudget` for production services.

## Configuration

- Use `ConfigMap` for non-sensitive config; reference in env with `envFrom` for cleanliness.
- Label all resources consistently: `app.kubernetes.io/name`, `app.kubernetes.io/version`, `app.kubernetes.io/managed-by`.
- Validate manifests with `kubeconform` or `kube-score` before applying.
