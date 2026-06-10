# Profiles

The first question the `init` wizard asks is **Team profile**. Your answer sets smart defaults for which rules, agents, and skills are pre-checked — you can still add or remove anything before confirming.

## How profiles work

Each preset (rule, agent, skill) has a `tags` array listing which profiles consider it a default. When you pick a profile, every preset tagged with that profile is pre-checked in the wizard. Presets not tagged for your profile are still available — just unchecked.

When you pick a profile, every collection tagged for that profile is pre-checked in the wizard. You can add or remove any collection before confirming.

## Default collections by profile

| Collection | Frontend | Backend | Full-stack | DevOps | Pure Infra | Custom |
| ---------- | :------: | :-----: | :--------: | :----: | :--------: | :----: |
| TypeScript | ✓ | ✓ | ✓ | — | — | — |
| Git | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Security | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Docs | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| DevOps | — | — | — | ✓ | ✓ | — |
| Next.js | ✓ | — | ✓ | — | — | — |

## Frontend

> UI, design systems, accessibility

### Rules

| Rule | Default | Description |
| ---- | ------- | ----------- |
| `type-safety` | yes | No `any`, no unguarded assertions, prefer `unknown` |
| `design-system-reuse` | — | Reuse shared UI components and tokens before creating new ones |

### Agents

| Agent | Default | Description |
| ----- | ------- | ----------- |
| `frontend-specialist` | yes | UI implementation, design-system, i18n, a11y |
| `test-specialist` | yes | Test creation, refactoring, stabilization |
| `docs-maintainer` | yes | Documentation synchronization with code changes |
| `code-reviewer` | — | PR review — patterns, naming, complexity, tests |
| `a11y-specialist` | — | WCAG 2.2 A/AA audit and remediation |

### Skills

| Skill | Default | Description |
| ----- | ------- | ----------- |
| `patterns` | yes | Apply reusable architecture and coding patterns |
| `docs-upkeep` | yes | Keep docs aligned with implementation changes |
| `workspace-hygiene` | yes | On-demand workspace audit before commits and PRs |
| `code-review` | — | Structured review checklist for PRs |

## Backend

> APIs, databases, auth, services

### Rules

| Rule | Default | Description |
| ---- | ------- | ----------- |
| `type-safety` | yes | No `any`, no unguarded assertions, prefer `unknown` |
| `no-console-log` | — | Forbid `console.*` in production code, use logger |
| `api-error-handling` | — | Structured error responses, never leak stack traces |
| `security-secrets` | — | Never hardcode secrets, tokens, or credentials |

### Agents

| Agent | Default | Description |
| ----- | ------- | ----------- |
| `backend-specialist` | yes | API design, database patterns, error handling, auth |
| `test-specialist` | yes | Test creation, refactoring, stabilization |
| `docs-maintainer` | yes | Documentation synchronization with code changes |
| `code-reviewer` | — | PR review — patterns, naming, complexity, tests |
| `security-specialist` | — | Vulnerability audit, dependency scanning, secrets management |

### Skills

| Skill | Default | Description |
| ----- | ------- | ----------- |
| `patterns` | yes | Apply reusable architecture and coding patterns |
| `docs-upkeep` | yes | Keep docs aligned with implementation changes |
| `workspace-hygiene` | yes | On-demand workspace audit before commits and PRs |
| `code-review` | — | Structured review checklist for PRs |
| `api-design` | — | RESTful conventions, pagination, versioning |
| `security-audit` | — | Dependency audit, secrets scan, OWASP patterns |
| `migration-safety` | — | Database migration review, rollback plans |

## Full-stack

> Frontend + backend combined

This profile is the union of Frontend and Backend defaults.

### Rules

| Rule | Default | Description |
| ---- | ------- | ----------- |
| `type-safety` | yes | No `any`, no unguarded assertions, prefer `unknown` |
| `no-console-log` | — | Forbid `console.*` in production code, use logger |
| `design-system-reuse` | — | Reuse shared UI components and tokens before creating new ones |
| `api-error-handling` | — | Structured error responses, never leak stack traces |
| `security-secrets` | — | Never hardcode secrets, tokens, or credentials |

### Agents

| Agent | Default | Description |
| ----- | ------- | ----------- |
| `frontend-specialist` | yes | UI implementation, design-system, i18n, a11y |
| `backend-specialist` | yes | API design, database patterns, error handling, auth |
| `test-specialist` | yes | Test creation, refactoring, stabilization |
| `docs-maintainer` | yes | Documentation synchronization with code changes |
| `code-reviewer` | — | PR review — patterns, naming, complexity, tests |
| `a11y-specialist` | — | WCAG 2.2 A/AA audit and remediation |
| `security-specialist` | — | Vulnerability audit, dependency scanning, secrets management |

### Skills

| Skill | Default | Description |
| ----- | ------- | ----------- |
| `patterns` | yes | Apply reusable architecture and coding patterns |
| `docs-upkeep` | yes | Keep docs aligned with implementation changes |
| `workspace-hygiene` | yes | On-demand workspace audit before commits and PRs |
| `code-review` | — | Structured review checklist for PRs |
| `api-design` | — | RESTful conventions, pagination, versioning |
| `security-audit` | — | Dependency audit, secrets scan, OWASP patterns |
| `migration-safety` | — | Database migration review, rollback plans |

## DevOps / Platform

> CI/CD, containers, infrastructure-as-code

### Rules

| Rule | Default | Description |
| ---- | ------- | ----------- |
| `security-secrets` | yes | Never hardcode secrets, tokens, or credentials |
| `docker-best-practices` | yes | Multi-stage builds, non-root users, layer caching |
| `container-image-pinning` | yes | Pin image versions everywhere — compose, Ansible, env vars |
| `idempotency` | yes | Every operation must be safe to re-run |
| `runbook-discipline` | yes | Keep runbooks and ADRs in sync with infra changes |
| `ansible-conventions` | — | FQCN modules, idempotency, Jinja2 safety |
| `jinja2-templates` | — | Safe templates with `\| default()` and variable scope |
| `terraform-conventions` | — | Module structure, naming, state management |
| `kubernetes-manifests` | — | Resource limits, health checks, security context |
| `helm-conventions` | — | Chart structure, safe defaults, secret handling |
| `shell-script-standards` | — | `set -euo pipefail`, shellcheck, quoting |
| `ci-workflow-conventions` | — | Pinned actions, OIDC, minimal permissions |

### Agents

| Agent | Default | Description |
| ----- | ------- | ----------- |
| `docs-maintainer` | yes | Documentation synchronization with code changes |
| `security-specialist` | — | Vulnerability audit, dependency scanning, secrets management |
| `infrastructure-specialist` | — | Build, CI, container, deployment config |
| `devops-specialist` | — | CI/CD pipelines, container optimization, IaC review |
| `ansible-specialist` | — | Ansible roles, playbooks, and Jinja2 templates |
| `kubernetes-specialist` | — | Manifests, Helm charts, Kustomize overlays |
| `sre-specialist` | — | SLOs, alerting, runbooks, post-mortems |

### Skills

| Skill | Default | Description |
| ----- | ------- | ----------- |
| `docs-upkeep` | yes | Keep docs aligned with implementation changes |
| `workspace-hygiene` | yes | On-demand workspace audit before commits and PRs |
| `stack-change-review` | yes | High-blast-radius infrastructure change review |
| `security-audit` | — | Dependency audit, secrets scan, OWASP patterns |
| `ci-cd-best-practices` | — | Pipeline optimization, caching strategies |
| `infrastructure-drift-check` | — | Verify declared IaC matches deployed state before merge |
| `rollback-plan` | — | Require tested rollback steps for every production change |

## Pure Infrastructure

> Ansible, Kubernetes, Terraform — no application code

Use this profile for repos that contain only infrastructure: Ansible roles, Kubernetes manifests, Helm charts, Docker Compose stacks, Terraform modules. There is no application code (no JS/TS, no Python services, no CI-built binaries).

This profile is scoped to infrastructure-only repos. It defaults to `git`, `security`, `docs`, and `devops` collections — the TypeScript collection is not included since there is no application code.

### Rules

| Rule | Default | Description |
| ---- | ------- | ----------- |
| `security-secrets` | yes | Never hardcode secrets, tokens, or credentials |
| `docker-best-practices` | yes | Multi-stage builds, non-root users, layer caching |
| `container-image-pinning` | yes | Pin image versions everywhere — compose, Ansible, env vars |
| `idempotency` | yes | Every operation must be safe to re-run |
| `runbook-discipline` | yes | Keep runbooks and ADRs in sync with infra changes |
| `ansible-conventions` | — | FQCN modules, idempotency, Jinja2 safety |
| `jinja2-templates` | — | Safe templates with `\| default()` and variable scope |
| `terraform-conventions` | — | Module structure, naming, state management |
| `kubernetes-manifests` | — | Resource limits, health checks, security context |
| `helm-conventions` | — | Chart structure, safe defaults, secret handling |
| `shell-script-standards` | — | `set -euo pipefail`, shellcheck, quoting |
| `ci-workflow-conventions` | — | Pinned actions, OIDC, minimal permissions |

### Agents

| Agent | Default | Description |
| ----- | ------- | ----------- |
| `docs-maintainer` | yes | Documentation synchronization with code changes |
| `security-specialist` | — | Vulnerability audit, dependency scanning, secrets management |
| `infrastructure-specialist` | — | Build, CI, container, deployment config |
| `devops-specialist` | — | CI/CD pipelines, container optimization, IaC review |
| `ansible-specialist` | — | Ansible roles, playbooks, and Jinja2 templates |
| `kubernetes-specialist` | — | Manifests, Helm charts, Kustomize overlays |
| `sre-specialist` | — | SLOs, alerting, runbooks, post-mortems |

### Skills

| Skill | Default | Description |
| ----- | ------- | ----------- |
| `docs-upkeep` | yes | Keep docs aligned with implementation changes |
| `workspace-hygiene` | yes | On-demand workspace audit before commits and PRs |
| `stack-change-review` | yes | High-blast-radius infrastructure change review |
| `security-audit` | — | Dependency audit, secrets scan, OWASP patterns |
| `ci-cd-best-practices` | — | Pipeline optimization, caching strategies |
| `infrastructure-drift-check` | — | Verify declared IaC matches deployed state before merge |
| `rollback-plan` | — | Require tested rollback steps for every production change |

## Custom

Pick everything individually. No collections are pre-checked. Use this when your project doesn't fit a standard profile or when you want full control.
