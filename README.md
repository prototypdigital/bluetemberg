# Blueprint

[![CI](https://github.com/prototypdigital/blueprint/actions/workflows/ci.yml/badge.svg)](https://github.com/prototypdigital/blueprint/actions/workflows/ci.yml)

Scaffold vendor-neutral AI tooling config (rules, agents, skills) with cross-platform sync for **Cursor**, **Claude Code**, and **GitHub Copilot**.

> **Internal package** — published to [GitHub Packages](https://github.com/orgs/prototypdigital/packages) under `@prototypdigital/blueprint`.

## Install

### 1. Authenticate with GitHub Packages

Add to your project's `.npmrc`:

```
@prototypdigital:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Set `GITHUB_TOKEN` to a personal access token with `read:packages` scope.

### 2. Run

```bash
npx @prototypdigital/blueprint init
```

The interactive wizard will ask you to pick:

- Target platforms (Cursor / Claude / Copilot)
- Starter rules (coding standards, no-console-log, etc.)
- Specialist agents (frontend, test, docs, a11y, infra)
- Skills (patterns, docs-upkeep, workspace-hygiene)
- MCP server configs (interactive prompts, context7, figma, github)

It scaffolds `llm/` as the vendor-neutral source of truth and generates platform-specific files.

## What it creates

```
your-project/
├── blueprint.config.json       # Platforms, targets, source dir
├── AGENTS.md                   # Project context for AI tools
├── CLAUDE.md                   # Claude-specific pointer (if Claude selected)
├── llm/
│   ├── rules/                  # Vendor-neutral rules
│   ├── agents/                 # Specialist agent definitions
│   └── skills/                 # On-demand skill workflows
├── .cursor/rules/              # Generated — do not edit
├── .claude/rules/              # Generated — do not edit
├── .claude/agents/             # Generated — do not edit
├── .claude/skills/             # Generated — do not edit
├── .github/instructions/       # Generated — do not edit
├── .github/agents/             # Generated — do not edit
└── .github/skills/             # Generated — do not edit
```

## Sync

After editing anything in `llm/`, regenerate platform files:

```bash
npx blueprint sync
```

Check mode for CI (exits 1 if out of sync):

```bash
npx blueprint sync --check
```

## How sync works

| Source                  | Cursor                | Claude                      | Copilot                                  |
| ----------------------- | --------------------- | --------------------------- | ---------------------------------------- |
| `llm/rules/*.md`        | `.cursor/rules/*.mdc` | `.claude/rules/*.md`        | `.github/instructions/*.instructions.md` |
| `llm/agents/*.md`       | —                     | `.claude/agents/*.md`       | `.github/agents/*.agent.md`              |
| `llm/skills/*/SKILL.md` | —                     | `.claude/skills/*/SKILL.md` | `.github/skills/*/SKILL.md`              |
| `AGENTS.md`             | —                     | —                           | `.github/copilot-instructions.md`        |

Rules get platform-specific frontmatter transforms:

- **Cursor**: `scope: '**'` -> `alwaysApply: true`; otherwise `globs: [scope]`
- **Claude**: `paths: [scope]`
- **Copilot**: `applyTo: scope`

Agents and skills are copied verbatim (only the filename extension changes).

## Documentation

See the [Wiki](https://github.com/prototypdigital/blueprint/wiki) for full documentation:

- [Installation](https://github.com/prototypdigital/blueprint/wiki/Installation)
- [Commands](https://github.com/prototypdigital/blueprint/wiki/Commands)
- [Configuration](https://github.com/prototypdigital/blueprint/wiki/Configuration)
- [Writing Rules](https://github.com/prototypdigital/blueprint/wiki/Writing-Rules)
- [Writing Agents](https://github.com/prototypdigital/blueprint/wiki/Writing-Agents)
- [Writing Skills](https://github.com/prototypdigital/blueprint/wiki/Writing-Skills)
- [Architecture](https://github.com/prototypdigital/blueprint/wiki/Architecture)
- [Consumer Setup](https://github.com/prototypdigital/blueprint/wiki/Consumer-Setup)
- [Contributing](https://github.com/prototypdigital/blueprint/wiki/Contributing)

## Development

```bash
git clone https://github.com/prototypdigital/blueprint.git
cd blueprint
npm install
npm run build
npm test
```

See [Contributing](https://github.com/prototypdigital/blueprint/wiki/Contributing) for commit conventions and release process.
