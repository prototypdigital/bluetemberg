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

| Source                              | Claude                                  | Copilot                                       |
| ----------------------------------- | --------------------------------------- | --------------------------------------------- |
| `llm/agents/frontend-specialist.md` | `.claude/agents/frontend-specialist.md` | `.github/agents/frontend-specialist.agent.md` |

Cursor does not support custom agent definitions, so agents are not synced there.

## Naming convention

- Use **kebab-case**: `frontend-specialist.md`, `test-specialist.md`
- `README.md` in `llm/agents/` is excluded from sync (use it for authoring notes)

## Available starter agents

| Agent                       | Description                                  |
| --------------------------- | -------------------------------------------- |
| `frontend-specialist`       | UI implementation, design-system, i18n, a11y |
| `test-specialist`           | Test creation, refactoring, stabilization    |
| `docs-maintainer`           | Documentation sync with code changes         |
| `a11y-specialist`           | WCAG 2.2 A/AA audit and remediation          |
| `infrastructure-specialist` | Build, CI, container, deployment config      |
