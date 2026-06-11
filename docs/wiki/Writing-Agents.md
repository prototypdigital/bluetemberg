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

Official agents ship as `bluetemberg-agents-*` packages from [prototypdigital/bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs). The init wizard writes an `llm/agent-packages.json` manifest; run `bluetemberg install` to download them.

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

- **Define the role clearly.** The first sentence should tell the AI exactly what hat it's wearing.
- **List tools explicitly.** `tools: ['read', 'search']` prevents an agent from making edits when it shouldn't.
- **Set constraints.** Boundaries prevent the agent from wandering outside its domain.
- **Use RFC 2119 keywords** (MUST, SHOULD, MAY) for behavior requirements — they map well to how LLMs interpret instructions.
- **Keep it focused.** One agent per domain. If an agent needs to do both security and testing, split it.
