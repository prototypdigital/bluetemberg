# Profiles

The first question the `init` wizard asks is **Team profile**. Your answer sets smart defaults for which rules, agents, and skills are pre-checked — you can still add or remove anything before confirming.

## How profiles work

Each preset (rule, agent, skill) has a `tags` array listing which profiles consider it a default. When you pick a profile, every preset tagged with that profile is pre-checked in the wizard. Presets not tagged for your profile are still available — just unchecked.

Universal rules bypass this system entirely. They are always included and cannot be deselected, regardless of which profile you pick.

## Universal guardrails (always included)

These rules are included in every project. They appear checked and marked **(required)** in the wizard.

| Rule | What it enforces |
| ---- | ---------------- |
| `coding-standards` | Function complexity, readability, naming conventions |
| `early-returns` | Guard clauses over nested conditionals |
| `git-move` | Use `git mv` for tracked files to preserve history |
| `never-read-env` | Never read `.env` files directly in code |
| `post-edit-diagnostics` | Run diagnostics and formatter after every edit |
| `pre-commit-checks` | Formatter, linter, and build pass before every commit |
| `docs-parity` | Doc updates ship in the same commit as behavior changes |

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
| `security-secrets` | — | Never hardcode secrets, tokens, or credentials |
| `docker-best-practices` | — | Multi-stage builds, non-root users, layer caching |
| `terraform-conventions` | — | Module structure, naming, state management |

### Agents

| Agent | Default | Description |
| ----- | ------- | ----------- |
| `docs-maintainer` | yes | Documentation synchronization with code changes |
| `security-specialist` | — | Vulnerability audit, dependency scanning, secrets management |
| `infrastructure-specialist` | — | Build, CI, container, deployment config |
| `devops-specialist` | — | CI/CD pipelines, container optimization, IaC review |

### Skills

| Skill | Default | Description |
| ----- | ------- | ----------- |
| `docs-upkeep` | yes | Keep docs aligned with implementation changes |
| `workspace-hygiene` | yes | On-demand workspace audit before commits and PRs |
| `security-audit` | — | Dependency audit, secrets scan, OWASP patterns |
| `ci-cd-best-practices` | — | Pipeline optimization, caching strategies |

## Custom

Pick everything individually. No presets are pre-checked (except universal guardrails, which are always included). Use this when your project doesn't fit a standard profile or when you want full control.
