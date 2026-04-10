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
- Target platforms (Cursor / Claude / Copilot / Gemini CLI)
- Starter rules — universal guardrails are always included; profile-specific rules are pre-checked based on your team type
- Specialist agents (frontend, test, docs, a11y, infra, security, devops)
- Skills (patterns, docs-upkeep, workspace-hygiene, code-review, api-design, etc.)
- MCP presets via `llm/mcp.json` → Claude / Copilot / **Cursor** MCP config (interactive, context7, figma, github)

You can also add **`llm/hooks.json`** (Cursor hooks), **`llm/commands/*.md`** (Claude slash commands), **`llm/prompts/*.md`** (Copilot `*.prompt.md`), and optional **`adapters`** in `bluetemberg.config.json` for custom ESM emitters; see the wiki (_Writing Hooks_, _Writing Commands_, _Writing Prompts_, _Adapters_).

It scaffolds `llm/` as the vendor-neutral source of truth, generates platform-specific files, and patches `.prettierignore` to protect your prose files from the formatter.

## What it creates

```
your-project/
├── bluetemberg.config.json     # Platforms, targets, source dir
├── AGENTS.md                   # Project context for AI tools
├── CLAUDE.md                   # Claude-specific pointer (if Claude selected)
├── GEMINI.md                   # Gemini CLI pointer (if Gemini selected) — do not edit
├── llm/
│   ├── rules/                  # Vendor-neutral rules
│   ├── agents/                 # Specialist agent definitions
│   ├── skills/                 # On-demand skill workflows
│   ├── mcp.json                # Optional — MCP presets and/or inline servers (if you add it)
│   ├── hooks.json              # Optional — Cursor hooks (if you add it)
│   ├── commands/               # Optional — Claude slash commands (if you add it)
│   └── prompts/                # Optional — Copilot prompt sources (if you add it)
├── .cursor/rules/              # Generated — do not edit
├── .cursor/skills/             # Gitignored — source of truth is llm/skills
├── .cursor/agents/             # Gitignored — source of truth is llm/agents
├── .cursor/mcp.json            # Generated (Cursor) — do not edit
├── .cursor/hooks.json          # Generated (Cursor) — do not edit
├── .claude/rules/              # Generated — do not edit
├── .claude/agents/             # Generated — do not edit
├── .claude/skills/             # Generated — do not edit
├── .github/instructions/       # Generated — do not edit
├── .github/agents/             # Generated — do not edit
├── .github/skills/             # Generated — do not edit
└── .gemini/context/            # Generated — do not edit
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

**Exit codes:** the CLI exits **1** if sync records **any** error (invalid `llm/hooks.json`, unknown MCP id, adapter failure, etc.), not only when `--check` finds drift. Use the exit code in CI, especially with `--silent`.

Optional **stale output cleanup** after you remove or rename sources under `llm/`:

```bash
npx bluetemberg sync --prune
```

`--prune` is ignored with `--check`. See the wiki ([Commands](https://github.com/prototypdigital/bluetemberg/wiki/Commands), [Configuration](https://github.com/prototypdigital/bluetemberg/wiki/Configuration)) for exit codes, `.gitattributes`, and prune caveats.

## How sync works

| Source                  | Cursor                      | Claude                      | Copilot                                  | Gemini CLI             |
| ----------------------- | --------------------------- | --------------------------- | ---------------------------------------- | ---------------------- |
| `llm/rules/*.md`        | `.cursor/rules/*.mdc`       | `.claude/rules/*.md`        | `.github/instructions/*.instructions.md` | `.gemini/context/*.md` |
| `llm/agents/*.md`       | `.cursor/agents/*.md`       | `.claude/agents/*.md`       | `.github/agents/*.agent.md`              | —                      |
| `llm/skills/*/SKILL.md` | `.cursor/skills/*/SKILL.md` | `.claude/skills/*/SKILL.md` | `.github/skills/*/SKILL.md`              | —                      |
| `llm/mcp.json`          | `.cursor/mcp.json`          | `.claude/mcp.json`          | `.github/mcp.json`                       | —                      |
| `llm/prompts/*.md`      | —                           | —                           | `.github/prompts/*.prompt.md`            | —                      |
| `AGENTS.md`             | —                           | —                           | `.github/copilot-instructions.md`        | `GEMINI.md`            |

Rules get platform-specific frontmatter transforms:

- **Cursor**: `scope: '**'` -> `alwaysApply: true`; otherwise `globs: [scope]`
- **Claude**: `paths: [scope]`
- **Copilot**: `applyTo: scope`
- **Gemini CLI**: `glob: scope`

Agents and skills are copied verbatim (only the filename extension changes).

**Monorepo and shared rule packs:** Add an `extends` field to `bluetemberg.config.json` to merge rules/agents/skills from additional source directories — relative paths (e.g. `"../../"` for the monorepo root) or npm package names (e.g. `"@company/ai-rules"`). Local files always take priority. See [Configuration](https://github.com/prototypdigital/bluetemberg/wiki/Configuration) for details.

**Programmatic API:** `import { sync, loadConfig, shouldExitWithFailure } from '@prototypdigital/bluetemberg'`. `sync()` returns a **Promise** (it may load optional `adapters`). Always **await** it, e.g. `const results = await sync(root, { config: loadConfig(root), prune: true });`. Use `shouldExitWithFailure(results, checkMode)` to mirror CLI exit semantics. Release notes for each version live in [CHANGELOG.md](CHANGELOG.md) (updated by Release Please). Breaking changes should use conventional commits—see [Contributing — Changelog and breaking changes](https://github.com/prototypdigital/bluetemberg/wiki/Contributing#changelog-and-breaking-changes).

## Documentation

See the [Wiki](https://github.com/prototypdigital/bluetemberg/wiki) for full documentation:

- [Why Bluetemberg](https://github.com/prototypdigital/bluetemberg/wiki/Why)
- [Installation](https://github.com/prototypdigital/bluetemberg/wiki/Installation)
- [Commands](https://github.com/prototypdigital/bluetemberg/wiki/Commands)
- [Configuration](https://github.com/prototypdigital/bluetemberg/wiki/Configuration)
- [Profiles](https://github.com/prototypdigital/bluetemberg/wiki/Profiles)
- [Writing Rules](https://github.com/prototypdigital/bluetemberg/wiki/Writing-Rules)
- [Writing Agents](https://github.com/prototypdigital/bluetemberg/wiki/Writing-Agents)
- [Writing Skills](https://github.com/prototypdigital/bluetemberg/wiki/Writing-Skills)
- [Writing Hooks](https://github.com/prototypdigital/bluetemberg/wiki/Writing-Hooks)
- [Writing Commands](https://github.com/prototypdigital/bluetemberg/wiki/Writing-Commands)
- [Writing Prompts](https://github.com/prototypdigital/bluetemberg/wiki/Writing-Prompts)
- [Adapters](https://github.com/prototypdigital/bluetemberg/wiki/Adapters)
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
