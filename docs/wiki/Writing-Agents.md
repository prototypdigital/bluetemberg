# Writing Agents

Agent definitions live in `llm/agents/` as Markdown files with YAML frontmatter.

## Format

```markdown
---
name: agent-name
description: One-line description of what this agent does.
tools: ['read', 'search', 'edit', 'execute']
---

# Agent Name

You are a [role] specialist. Your job is to [responsibility].

## Responsibilities

- First responsibility
- Second responsibility

## Constraints

- First constraint
- Second constraint
```

## Frontmatter fields

### `name` (required)

Kebab-case identifier matching the filename. Example: `frontend-specialist`.

### `description` (required)

One-line description of the agent's purpose.

### `tools` (optional)

Array of tool capabilities the agent should have access to. Common values: `read`, `search`, `edit`, `execute`, `agent`.

## How agents are synced

Unlike rules, agents are copied **verbatim** — no frontmatter transformation. Only the file extension changes:

| Source                              | Cursor                                  | Claude                                  | Copilot                                       |
| ----------------------------------- | --------------------------------------- | --------------------------------------- | --------------------------------------------- |
| `llm/agents/frontend-specialist.md` | `.cursor/agents/frontend-specialist.md` | `.claude/agents/frontend-specialist.md` | `.github/agents/frontend-specialist.agent.md` |

On Cursor, these files are **project subagents** (see Cursor documentation for subagents). Optional `tools:` in frontmatter is aimed at Claude Code; Cursor may ignore unknown keys.

> **Note:** Unlike rules, agents have no platform-specific frontmatter transform. There is intentionally one canonical source file per agent. If a future platform requires a different frontmatter shape, add a dedicated transform step in `src/sync/index.ts` rather than splitting the source file.

## Naming convention

- Use **kebab-case**: `frontend-specialist.md`, `test-specialist.md`
- `README.md` in `llm/agents/` is excluded from sync (use it for authoring notes)

## Official agent packages

Official agents ship as `bluetemberg-agents-*` packages from [prototypdigital/bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs). The init wizard writes the `llm/packages.json` manifest; run `bluetemberg install` to download them.

| Package | Tags | Description |
| ------- | ---- | ----------- |
| `bluetemberg-agents-frontend-specialist` | frontend, fullstack | UI implementation, design-system, i18n, a11y |
| `bluetemberg-agents-backend-specialist` | backend, fullstack | API design, database patterns, error handling, auth |
| `bluetemberg-agents-test-specialist` | frontend, backend, fullstack | Test creation, refactoring, stabilization |
| `bluetemberg-agents-docs-maintainer` | all | Documentation synchronization with code changes |
| `bluetemberg-agents-code-reviewer` | frontend, backend, fullstack | PR review — patterns, naming, complexity, tests |
| `bluetemberg-agents-a11y-specialist` | frontend, fullstack | WCAG 2.2 A/AA audit and remediation |
| `bluetemberg-agents-security-specialist` | backend, fullstack, devops | Vulnerability audit, dependency scanning, secrets management |
| `bluetemberg-agents-infrastructure-specialist` | devops | Build, CI, container, deployment config |
| `bluetemberg-agents-devops-specialist` | devops | CI/CD pipelines, container optimization, IaC review |
| `bluetemberg-agents-ansible-specialist` | devops | Ansible roles, playbooks, and Jinja2 templates |
| `bluetemberg-agents-kubernetes-specialist` | devops | Manifests, Helm charts, Kustomize overlays |
| `bluetemberg-agents-sre-specialist` | devops | SLOs, alerting, runbooks, post-mortems |

You can also write custom local agents directly in `llm/agents/` — local files always take priority over package content.

## Writing a good agent

- **Make the description a delegation trigger.** State what the agent does AND when to route to it, in third person; add a proactive cue (`use proactively after code changes`, `MUST BE USED for X`) when you want auto-delegation. The `description` is what drives routing — not the body.
- **Define the role clearly.** The first sentence should tell the AI exactly what hat it's wearing.
- **Least-privilege tools.** A read-only review/audit agent gets `['read', 'search']` only — never `edit`/`execute`. Keep the constraint prose and the `tools` array in lockstep (defense in depth).
- **Declare an output/return format.** A sub-agent reports a summary back to the caller; an explicit return shape prevents duplicated or garbled work.
- **Set layered constraints.** What it must NOT do, where it defers, and what blocks release.
- **Use RFC 2119 keywords** (MUST, SHOULD, MAY) for behavior requirements — rationed, not on every line.
- **Keep it focused.** One agent per domain; prefer extending one over proliferating near-duplicates. Match the model tier to the role (cheaper/faster for narrow, read-only, high-volume specialists).

The full, source-cited quality bar lives in the packs wiki: [Authoring Standards](https://github.com/prototypdigital/bluetemberg-packs/wiki/Authoring-Standards#agents--delegated-specialist-sub-agents).
