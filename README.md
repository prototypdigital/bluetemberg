# Bluetemberg :light_blue_heart:

[![CI](https://github.com/prototypdigital/bluetemberg/actions/workflows/ci.yml/badge.svg)](https://github.com/prototypdigital/bluetemberg/actions/workflows/ci.yml)

Scaffold vendor-neutral AI tooling config (rules, agents, skills) with cross-platform sync for **Cursor**, **Claude Code**, and **GitHub Copilot**.

> **Internal package** — published to [GitHub Packages](https://github.com/orgs/prototypdigital/packages) under `@prototypdigital/bluetemberg`.

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
npx @prototypdigital/bluetemberg init
```

The interactive wizard will ask you to pick:

- **Team profile** — frontend, backend, full-stack, DevOps, or custom (sets smart defaults for everything below)
- Target platforms (Cursor / Claude / Copilot)
- Starter rules — universal guardrails are always included; profile-specific rules are pre-checked based on your team type
- Specialist agents (frontend, test, docs, a11y, infra, security, devops)
- Skills (patterns, docs-upkeep, workspace-hygiene, code-review, api-design, etc.)
- MCP server configs (interactive prompts, context7, figma, github)

It scaffolds `llm/` as the vendor-neutral source of truth, generates platform-specific files, and patches `.prettierignore` to protect your prose files from the formatter.

## What it creates

```
your-project/
├── bluetemberg.config.json     # Platforms, targets, source dir
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

## Universal guardrails

Seven rules are always included regardless of team profile and cannot be deselected in the wizard. They represent the baseline every project needs:

| Rule                    | What it enforces                                        |
| ----------------------- | ------------------------------------------------------- |
| `coding-standards`      | Function complexity, readability, naming                |
| `early-returns`         | Guard clauses over nested conditionals                  |
| `git-move`              | `git mv` for tracked files to preserve history          |
| `never-read-env`        | No direct `.env` reads in code                          |
| `post-edit-diagnostics` | Run diagnostics and formatter after every edit          |
| `pre-commit-checks`     | Formatter, linter, and build pass before every commit   |
| `docs-parity`           | Doc updates ship in the same commit as behavior changes |

All other rules are opt-in and filtered by your chosen team profile.

## Sync

After editing anything in `llm/`, regenerate platform files:

```bash
npx bluetemberg sync
```

Check mode for CI (exits 1 if out of sync):

```bash
npx bluetemberg sync --check
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

See the [Wiki](https://github.com/prototypdigital/bluetemberg/wiki) for full documentation:

- [Installation](https://github.com/prototypdigital/bluetemberg/wiki/Installation)
- [Commands](https://github.com/prototypdigital/bluetemberg/wiki/Commands)
- [Configuration](https://github.com/prototypdigital/bluetemberg/wiki/Configuration)
- [Profiles](https://github.com/prototypdigital/bluetemberg/wiki/Profiles)
- [Writing Rules](https://github.com/prototypdigital/bluetemberg/wiki/Writing-Rules)
- [Writing Agents](https://github.com/prototypdigital/bluetemberg/wiki/Writing-Agents)
- [Writing Skills](https://github.com/prototypdigital/bluetemberg/wiki/Writing-Skills)
- [Architecture](https://github.com/prototypdigital/bluetemberg/wiki/Architecture)
- [Consumer Setup](https://github.com/prototypdigital/bluetemberg/wiki/Consumer-Setup)
- [Contributing](https://github.com/prototypdigital/bluetemberg/wiki/Contributing)

## Development

```bash
git clone https://github.com/prototypdigital/bluetemberg.git
cd bluetemberg
npm install
npm run build
npm test
```

See [Contributing](https://github.com/prototypdigital/bluetemberg/wiki/Contributing) for commit conventions and release process.
