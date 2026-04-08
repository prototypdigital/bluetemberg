# Blueprint

Scaffold vendor-neutral AI tooling config (rules, agents, skills) with cross-platform sync for **Cursor**, **Claude Code**, and **GitHub Copilot**.

## Quick start

```bash
npx @prototypdigital/blueprint init
```

The interactive wizard will ask you to pick:

- Target platforms (Cursor / Claude / Copilot)
- Starter rules (coding standards, no-console-log, etc.)
- Specialist agents (frontend, test, docs, a11y, infra)
- Skills (patterns, docs-upkeep, workspace-hygiene)
- MCP server configs (interactive prompts, context7, figma, github)

It then scaffolds `llm/` as the vendor-neutral source of truth and generates platform-specific files.

## What it creates

```
your-project/
├── blueprint.config.json       # Platforms, targets, source dir
├── AGENTS.md                   # Project context for AI tools
├── CLAUDE.md                   # Claude-specific pointer (if Claude selected)
├── llm/
│   ├── rules/                  # Vendor-neutral rules (frontmatter: description, scope)
│   ├── agents/                 # Specialist agent definitions
│   └── skills/                 # On-demand skill workflows
├── .cursor/rules/              # Generated — do not edit
├── .claude/rules/              # Generated — do not edit
├── .claude/agents/             # Generated — do not edit
├── .claude/skills/             # Generated — do not edit
├── .claude/mcp.json            # MCP server config (if selected)
├── .github/instructions/       # Generated — do not edit
├── .github/agents/             # Generated — do not edit
├── .github/skills/             # Generated — do not edit
└── .github/mcp.json            # MCP server config (if selected)
```

## Sync

After editing anything in `llm/`, run sync to regenerate platform files:

```bash
npx blueprint sync
```

Check mode for CI (exits 1 if out of sync):

```bash
npx blueprint sync --check
```

If you ran `init`, your `package.json` already has these scripts:

```bash
npm run sync:llm-config        # same as npx blueprint sync
npm run sync:llm-config:check  # same as npx blueprint sync --check
```

## How sync works

| Source                  | Cursor                | Claude                      | Copilot                                  |
| ----------------------- | --------------------- | --------------------------- | ---------------------------------------- |
| `llm/rules/*.md`        | `.cursor/rules/*.mdc` | `.claude/rules/*.md`        | `.github/instructions/*.instructions.md` |
| `llm/agents/*.md`       | —                     | `.claude/agents/*.md`       | `.github/agents/*.agent.md`              |
| `llm/skills/*/SKILL.md` | —                     | `.claude/skills/*/SKILL.md` | `.github/skills/*/SKILL.md`              |
| `AGENTS.md`             | —                     | —                           | `.github/copilot-instructions.md`        |

**Rules** get platform-specific frontmatter transforms:

- **Cursor**: `scope: '**'` → `alwaysApply: true`; otherwise `globs: [scope]`
- **Claude**: `paths: [scope]`
- **Copilot**: `applyTo: scope`

**Agents** and **skills** are copied verbatim (only the filename extension changes).

## Configuration

`blueprint.config.json` stores your project's setup:

```json
{
  "platforms": ["cursor", "claude", "copilot"],
  "source": "llm",
  "targets": {
    "rules": {
      "cursor": { "dir": ".cursor/rules", "ext": ".mdc" },
      "claude": { "dir": ".claude/rules", "ext": ".md" },
      "copilot": { "dir": ".github/instructions", "ext": ".instructions.md" }
    },
    "agents": {
      "claude": { "dir": ".claude/agents", "ext": ".md" },
      "copilot": { "dir": ".github/agents", "ext": ".agent.md" }
    },
    "skills": {
      "claude": { "dir": ".claude/skills" },
      "copilot": { "dir": ".github/skills" }
    }
  }
}
```

## Writing rules

Rules live in `llm/rules/` as Markdown with YAML frontmatter:

```markdown
---
description: Short description of what this rule enforces.
scope: "**"
---

# Rule Title

Rule content in Markdown.
```

- `scope: '**'` — applies globally (all files)
- `scope: 'src/**'` — applies to files matching the glob
- `scope: ['src/**', 'lib/**']` — multiple globs

## CI integration

Add to your GitHub Actions workflow:

```yaml
- name: Check AI config sync
  run: npx blueprint sync --check
```

## Development

```bash
npm install
npm test
```
