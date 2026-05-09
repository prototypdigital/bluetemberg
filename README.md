# Bluetemberg :light_blue_heart:

[![CI](https://github.com/prototypdigital/bluetemberg/actions/workflows/ci.yml/badge.svg)](https://github.com/prototypdigital/bluetemberg/actions/workflows/ci.yml)

Scaffold vendor-neutral AI tooling config (rules, agents, skills) with cross-platform sync for **Cursor**, **Claude Code**, **GitHub Copilot**, and **Windsurf** — and optional **Claude Code Marketplace** distribution so teammates can install profile-matched rule + skill + agent packs without any local tooling.

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

Agents and CI never get a usable TTY, so **`init`** also supports deterministic paths:

```bash
# Profile defaults (+ optional overrides) without prompts
npx @prototypdigital/bluetemberg init --non-interactive --profile devops

# Full answers from JSON (matches the `InitAnswers` field list in packaged types / `bluetemberg --help --json`)
npx @prototypdigital/bluetemberg init --config ./bluetemberg.init.json

# Quiet CI logs (still check exit codes; pairs with `--non-interactive` or `--config`)
npx @prototypdigital/bluetemberg init --non-interactive --profile devops --silent

# Machine-readable catalogs (profiles, rules, agents, skills, MCP presets, CLI flags)
npx @prototypdigital/bluetemberg --help --json
```

Developing from a clone: run `npm run build` before `bin/cli.js` — the CLI imports `dist/` (including `--help --json` and preset validation constants).

The interactive wizard will ask you to pick:

- **Team profile** — Frontend, Backend, Full-stack, DevOps / Platform, **pure-infra** (infrastructure-only repos), or Custom — sets defaults for rules, agents, and skills (`--profile pure-infra` in headless runs)
- Target platforms (Cursor / Claude / Copilot / Gemini CLI / Windsurf)
- Starter rules — **universal guardrails depend on profile** (`pure-infra` omits app-code-centric universals—see wiki **Profiles**); other defaults are pre-checked by team type
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
├── .gemini/context/            # Generated — do not edit
├── .windsurf/rules/            # Generated — do not edit
├── .windsurf/skills/           # Generated — do not edit
└── .windsurf/workflows/        # Generated — do not edit
```

When `claude-marketplace` is in `platforms`, sync also generates:

```
.claude-plugin/
└── marketplace.json            # Root manifest listing all plugins
plugins/
├── frontend/                   # Rules + skills + agents for frontend devs
├── fullstack/                  # Rules + skills + agents for full-stack devs
├── backend/                    # Rules + skills + agents for backend devs
└── devops/                     # Rules + skills + agents for DevOps / platform engineers
```

## Universal guardrails

**Default set (Frontend, Backend, Full-stack, DevOps / Platform, Custom):** seven rules cannot be deselected in the wizard:

| Rule                    | What it enforces                                        |
| ----------------------- | ------------------------------------------------------- |
| `coding-standards`      | Function complexity, readability, naming                |
| `early-returns`         | Guard clauses over nested conditionals                  |
| `git-move`              | `git mv` for tracked files to preserve history          |
| `never-read-env`        | No direct `.env` reads in code                          |
| `post-edit-diagnostics` | Run diagnostics and formatter after every edit          |
| `pre-commit-checks`     | Formatter, linter, and build pass before every commit   |
| `docs-parity`           | Doc updates ship in the same commit as behavior changes |

**Pure Infrastructure (`pure-infra`):** for repos with no application source (Ansible, K8s, Terraform, Compose, etc.), the wizard omits the app-centric rules above (`coding-standards`, `early-returns`, `post-edit-diagnostics`). It still forces `git-move`, `never-read-env`, `pre-commit-checks`, and `docs-parity`.

All other rules are opt-in defaults by profile (or fully manual for Custom).

Detail: [`docs/wiki/Profiles.md`](docs/wiki/Profiles.md) (**Pure Infrastructure** section).

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

| Source                  | Cursor                      | Claude                                 | Copilot                                  | Gemini CLI             | Windsurf               |
| ----------------------- | --------------------------- | -------------------------------------- | ---------------------------------------- | ---------------------- | ---------------------- |
| `llm/rules/*.md`        | `.cursor/rules/*.mdc`       | `.claude/rules/*.md`                   | `.github/instructions/*.instructions.md` | `.gemini/context/*.md` | `.windsurf/rules/*.md` |
| `llm/agents/*.md`       | `.cursor/agents/*.md`       | `.claude/agents/*.md`                  | `.github/agents/*.agent.md`              | —                      | —                      |
| `llm/skills/*/SKILL.md` | `.cursor/skills/*/SKILL.md` | `.claude/skills/*/SKILL.md`            | `.github/skills/*/SKILL.md`              | —                      | `.windsurf/skills/*/SKILL.md` |
| `llm/mcp.json`          | `.cursor/mcp.json`          | `.claude/mcp.json`                     | `.github/mcp.json`                       | —                      | —                                |
| `llm/commands/*.md`     | —                           | `.claude/commands/*.md`                | —                                        | —                      | `.windsurf/workflows/*.md`       |
| `llm/prompts/*.md`      | —                           | —                                      | `.github/prompts/*.prompt.md`            | —                      | —                                |
| `AGENTS.md`             | —                           | —                                      | `.github/copilot-instructions.md`        | `GEMINI.md`            | —                                |
| `llm/` (marketplace)    | —                           | `plugins/*/rules \| skills \| agents/` | —                                        | —                      | —                      |

Rules get platform-specific frontmatter transforms:

- **Cursor**: `scope: '**'` -> `alwaysApply: true`; otherwise `globs: [scope]`
- **Claude**: `paths: [scope]`
- **Copilot**: `applyTo: scope`
- **Gemini CLI**: `glob: scope`
- **Windsurf**: `scope: '**'` -> `trigger: always_on`; otherwise `trigger: glob`, `glob: scope`

Agents and skills are copied verbatim (only the filename extension changes).

**Monorepo and shared rule packs:** Add an `extends` field to `bluetemberg.config.json` to merge rules/agents/skills from additional source directories — relative paths (e.g. `"../../"` for the monorepo root) or npm package names (e.g. `"@company/ai-rules"`). Local files always take priority. See [Configuration](https://github.com/prototypdigital/bluetemberg/wiki/Configuration) for details.

**Programmatic API:** `import { sync, loadConfig, shouldExitWithFailure } from '@prototypdigital/bluetemberg'`. `sync()` returns a **Promise** (it may load optional `adapters`). Always **await** it, e.g. `const results = await sync(root, { config: loadConfig(root), prune: true });`. Use `shouldExitWithFailure(results, checkMode)` to mirror CLI exit semantics. Release notes for each version live in [CHANGELOG.md](CHANGELOG.md) (updated by Release Please). Breaking changes should use conventional commits—see [Contributing — Changelog and breaking changes](https://github.com/prototypdigital/bluetemberg/wiki/Contributing#changelog-and-breaking-changes).

## Marketplace

Add `"claude-marketplace"` to `platforms` and define plugins in `bluetemberg.config.json` to emit installable Claude Code plugin bundles:

```json
{
  "platforms": ["claude", "claude-marketplace"],
  "marketplace": {
    "remote": "your-org/claude-marketplace",
    "plugins": [
      { "name": "frontend", "displayName": "Frontend Developer", "profiles": ["frontend"] },
      {
        "name": "fullstack",
        "displayName": "Full-Stack Developer",
        "profiles": ["frontend", "backend", "fullstack"]
      },
      { "name": "backend", "displayName": "Backend Developer", "profiles": ["backend"] },
      { "name": "devops", "displayName": "DevOps Engineer", "profiles": ["devops", "pure-infra"] }
    ]
  }
}
```

Each plugin bundles only the skills and agents whose `profiles` frontmatter (or preset tags) overlap with the plugin's `profiles` list. Skills and agents with no profile are included everywhere.

When `remote` is set, `bluetemberg sync` writes `extraKnownMarketplaces` to `.claude/settings.json` — Claude Code then auto-prompts teammates to install the relevant plugin when they open the project. **Teammates need no local bluetemberg install.**

See [docs/wiki/Marketplace.md](docs/wiki/Marketplace.md) for the full setup guide including the CI push workflow.

## Documentation

See the [Wiki](https://github.com/prototypdigital/bluetemberg/wiki) for full documentation:

- [Why Bluetemberg](https://github.com/prototypdigital/bluetemberg/wiki/Why)
- [Installation](https://github.com/prototypdigital/bluetemberg/wiki/Installation)
- [Commands](https://github.com/prototypdigital/bluetemberg/wiki/Commands)
- [Configuration](https://github.com/prototypdigital/bluetemberg/wiki/Configuration)
- [Profiles](https://github.com/prototypdigital/bluetemberg/wiki/Profiles)
- [Marketplace](https://github.com/prototypdigital/bluetemberg/wiki/Marketplace)
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

The checked-in CLI invokes `dist/` (`init`, catalogs, **`--help --json`**): keep **`npm run build`** up to date locally.

See [Contributing](https://github.com/prototypdigital/bluetemberg/wiki/Contributing) for commit conventions and release process.
