# Bluetemberg :light_blue_heart:

[![npm version](https://img.shields.io/npm/v/bluetemberg.svg)](https://www.npmjs.com/package/bluetemberg) [![CI](https://github.com/prototypdigital/bluetemberg/actions/workflows/ci.yml/badge.svg)](https://github.com/prototypdigital/bluetemberg/actions/workflows/ci.yml)

**Publish AI standards once to npm. Every engineer gets version-locked, integrity-verified rules, agents, and skills — matched to their role — with one command.**

A platform team maintains packs in [bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs). Developers run `bluetemberg init --profile frontend` + `bluetemberg install`. Teammates with no local tooling install a Claude Code Marketplace plugin with one click. Everyone stays in sync.

> Published on npm as [`bluetemberg`](https://www.npmjs.com/package/bluetemberg) — MIT licensed. Requires **Node.js 20+**.

**[prototypdigital.github.io/bluetemberg →](https://prototypdigital.github.io/bluetemberg/)** — install guide, pack browser, and docs.

**Supply-chain controls:** SHA-512 integrity and ECDSA registry signatures verified on every install. Registry host is pinned — metadata cannot redirect downloads to an attacker-controlled host. Tarballs are size-capped and path-traversal-filtered on extraction. See [SECURITY.md](SECURITY.md).

## Why not a shared AGENTS.md?

|                         | Shared `AGENTS.md` | bluetemberg                                      |
| ----------------------- | ------------------ | ------------------------------------------------ |
| Versioning              | git history        | semver ranges + lockfile                         |
| Integrity verification  | none               | SHA-512 + ECDSA registry signature per pack      |
| Per-role filtering      | manual copy-paste  | profiles (role-matched defaults)                 |
| Teammate onboarding     | clone + copy files | `init --profile X` + `install`                   |
| Zero-install onboarding | no                 | Claude Marketplace plugin                        |
| Multi-platform          | no                 | Cursor, Claude, Copilot, Gemini, Windsurf, Codex |

Profiles are **role-matched default selections** — not bundles. The wizard pre-selects the collections, agents, and skills most relevant to your role. You can add or remove anything. The value is that the content behind those selections is versioned, integrity-verified, and fetched from npm like an ESLint plugin.

## Install

```bash
npx bluetemberg init
```

Or add it as a dev dependency:

```bash
npm install -D bluetemberg
# or
pnpm add -D bluetemberg
```

Agents and CI never get a usable TTY, so **`init`** also supports deterministic paths:

```bash
# Profile defaults (+ optional overrides) without prompts
npx bluetemberg init --non-interactive --profile devops

# Full answers from JSON (matches the `InitAnswers` field list in packaged types / `bluetemberg --help --json`)
npx bluetemberg init --config ./bluetemberg.init.json

# Quiet CI logs (still check exit codes; pairs with `--non-interactive` or `--config`)
npx bluetemberg init --non-interactive --profile devops --silent

# Machine-readable catalogs (profiles, rules, agents, skills, MCP presets, CLI flags)
npx bluetemberg --help --json
```

Developing from a clone: run `npm run build` before `bin/cli.js` — the CLI imports `dist/` (including `--help --json` and preset validation constants).

The interactive wizard will ask you to pick:

- **Team profile** — Frontend, Backend, Full-stack, DevOps / Platform, **pure-infra** (infrastructure-only repos), **agentic** (LLM-heavy / AI workflow projects), or Custom — sets defaults for rules, agents, and skills (`--profile agentic` in headless runs)
- Target platforms (Cursor / Claude / Copilot / Gemini CLI / Windsurf / OpenAI Codex)
- **Stacks** — detected from the project and pre-checked (e.g. Payload 3.4.1, Next 15); drive which rules apply by version, written to config `stacks` (`--stacks payload@3.4.1,nextjs@auto` in headless runs)
- **Rule source** — versioned **rule collections** from the registry, or **empty** (bring your own rules / point at an external rule repo)
- Rule collections pre-selected by profile — defaults depend on team type (see wiki **Profiles**)
- Specialist agents (frontend, test, docs, a11y, infra, security, devops)
- Skills (patterns, docs-upkeep, workspace-hygiene, code-review, api-design, etc.)
- MCP presets via `llm/mcp.json` → Claude / Copilot / **Cursor** MCP config (interactive, context7, figma, github)
- **External rule sources** (optional) — pull rules from a GitHub repo, PRPM, or cursor.directory, translated to native format and pinned in `llm/rule-sources.json` (`--sources <csv>` in headless runs)

You can also add **`llm/hooks.json`** (Cursor hooks), **`llm/commands/*.md`** (Claude slash commands), **`llm/prompts/*.md`** (Copilot `*.prompt.md`), and optional **`adapters`** in `bluetemberg.config.json` for custom ESM emitters; see the wiki (_Writing Hooks_, _Writing Commands_, _Writing Prompts_, _Adapters_).

It scaffolds `llm/` as the vendor-neutral source of truth, generates platform-specific files, and patches `.prettierignore` to protect your prose files from the formatter.

## What it creates

```
your-project/
├── bluetemberg.config.json     # Platforms, targets, source dir
├── AGENTS.md                   # Project context for AI tools (Codex rules block appended if Codex selected)
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
├── .windsurf/workflows/        # Generated — do not edit
├── .agents/skills/             # Generated (Codex skills, vendor-neutral) — do not edit
├── .codex/agents/              # Generated (Codex subagents, TOML) — do not edit
└── .codex/config.toml          # Generated MCP block (Codex) — managed section only
```

When `claude-marketplace` is in `platforms`, sync also generates:

```
.claude-plugin/
└── marketplace.json            # Root manifest listing all plugins
plugins/
└── <plugin-name>/              # One directory per plugin defined in marketplace.plugins
```

Official Bluetemberg plugin packs (frontend, fullstack, backend, devops) are served from [prototypdigital/claude-marketplace](https://github.com/prototypdigital/claude-marketplace), generated from [bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs) content — add them with `/plugin marketplace add prototypdigital/claude-marketplace`. See [Marketplace](https://github.com/prototypdigital/bluetemberg/wiki/Marketplace).

## Rule collections by profile

Rules are delivered as versioned npm packages from the [bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs) registry. The init wizard pre-selects collections based on your team profile; you can add or remove any collection before confirming.

**Core packs (all standard profiles)** — auto-included for all profiles except Custom (Custom users must opt into these collections manually):

| Collection | Package                      | Content                                                            |
| ---------- | ---------------------------- | ------------------------------------------------------------------ |
| Git        | `bluetemberg-rules-git`      | Branch protection, commit conventions, git move, pre-commit checks |
| Security   | `bluetemberg-rules-security` | Never read .env, secrets management, API error handling            |
| Docs       | `bluetemberg-rules-docs`     | Docs parity, post-edit diagnostics, Mermaid diagrams               |

**Profile-specific packs:**

| Collection | Package                        | Profiles                      |
| ---------- | ------------------------------ | ----------------------------- |
| TypeScript | `bluetemberg-rules-typescript` | Frontend, Backend, Full-stack |
| DevOps     | `bluetemberg-rules-devops`     | DevOps, Pure Infra            |
| Next.js    | `bluetemberg-rules-nextjs`     | Frontend, Full-stack          |

After `init`, run `bluetemberg install` to download the packs listed in `llm/packages.json` into the local cache (`.bluetemberg/packs/`); `sync` merges them with your local `llm/` content.

Use `bluetemberg install --dry-run` to preview what would be installed without writing anything to disk.

Detail: [`docs/wiki/Registry.md`](docs/wiki/Registry.md) and [`docs/wiki/Profiles.md`](docs/wiki/Profiles.md).

## Switching profile

`bluetemberg init` records the selected team profile under `profile` in `bluetemberg.config.json`. To change profile later without re-running the full init wizard:

```bash
npx bluetemberg switch-profile backend
```

The command is **non-destructive**:

- Adds the new profile's default agent and skill packages to `llm/packages.json` if missing.
- Never removes packages or touches your local `llm/` files.
- Reports official agent/skill packages that are outside the new profile's defaults so you can review and remove them manually (rule collections and third-party packs are never flagged).
- Updates `profile` in `bluetemberg.config.json`.

Run `bluetemberg install` and `npx bluetemberg sync` afterwards to download new packs and regenerate platform files.

## Managing packs

After init you can manage packs directly without touching `llm/packages.json` by hand:

```bash
npx bluetemberg install                          # download all packs listed in llm/packages.json
npx bluetemberg update                           # update all packs to latest matching semver range
npx bluetemberg update bluetemberg-rules-nextjs  # update a single pack
npx bluetemberg add bluetemberg-rules-nextjs     # add a new pack
npx bluetemberg remove bluetemberg-rules-nextjs  # remove a pack
npx bluetemberg list                             # show installed packs and resolved versions
```

Run `bluetemberg sync` after any change to regenerate platform files. See [Registry](https://github.com/prototypdigital/bluetemberg/wiki/Registry) for the manifest format, lockfile, and pack cache layout.

## Sync

After editing anything in `llm/`, regenerate platform files:

```bash
npx bluetemberg sync
```

Check mode for CI (exits 1 if out of sync):

```bash
npx bluetemberg sync --check
```

Add `--diff` to see _what_ drifted, not just how many files — a per-file unified diff (summary counts + `@@` hunks) under each out-of-sync path. It implies `--check`, honors `--silent`, and never changes counts or the exit code:

```bash
npx bluetemberg sync --check --diff
```

**Exit codes:** the CLI exits **1** if sync records **any** error (invalid `llm/hooks.json`, unknown MCP id, adapter failure, etc.), not only when `--check` finds drift. Use the exit code in CI, especially with `--silent`.

Optional **stale output cleanup** after you remove or rename sources under `llm/`:

```bash
npx bluetemberg sync --prune
```

`--prune` is ignored with `--check`. See the wiki ([Commands](https://github.com/prototypdigital/bluetemberg/wiki/Commands), [Configuration](https://github.com/prototypdigital/bluetemberg/wiki/Configuration)) for exit codes, `.gitattributes`, and prune caveats.

## Stacks (version-aware routing)

A second routing axis orthogonal to profiles (role): **stacks** answer _what you build with_. Tag a rule or guardrail with a version range and sync delivers it **only where it's correct** — a Payload-2 rule never reaches a Payload-3 repo.

```yaml
# llm/rules/payload-rsc-admin.md frontmatter
stacks:
  payload: '>=3 <4'
```

```jsonc
// bluetemberg.config.json — declare or pin the project's stacks
{ "stacks": { "payload": "3.4.1", "nextjs": "auto" } }
```

`sync` detects the project's stacks (declared version → `node_modules` → lockfile → coerced `package.json` range), then hard-excludes rules whose range the detected version doesn't satisfy — listing what it filtered so you can audit it. Content with no `stacks:` is stack-agnostic and always applies, so projects that declare no stacks behave exactly as before.

Inspect detection and coverage — these have a `--json` twin for agents:

```bash
npx bluetemberg detect              # detected stacks, versions, confidence, gaps
npx bluetemberg coverage payload@3  # is there version-correct guidance for this stack?
```

Or expose the same model to an agent as MCP tools (`detect_stacks`, `query_coverage`, `list_stacks`, `org_histogram`) — read-only, over stdio:

```bash
npx bluetemberg mcp serve
```

Maintainers can scan several repos at once to see which `(stack, version)` eras are worth authoring rules for — a read-only usage histogram ranked by coverage gaps. Scan local clones, or read manifests straight from a GitHub org over the API (no cloning) with a `GITHUB_TOKEN`/`GH_TOKEN` in your environment:

```bash
npx bluetemberg scan-org ../app-a ../app-b               # local clones
npx bluetemberg scan-org --org acme --json               # every repo in the acme org
npx bluetemberg scan-org --repos acme/app,acme/web       # specific repos
```

See [Configuration](https://github.com/prototypdigital/bluetemberg/wiki/Configuration#stacks), [Writing Rules](https://github.com/prototypdigital/bluetemberg/wiki/Writing-Rules), and [Commands](https://github.com/prototypdigital/bluetemberg/wiki/Commands) for the full model.

## External sources

Pull rules from outside the npm pack registry — e.g. a community GitHub repo of `.cursorrules`/`.mdc` files — and Bluetemberg translates them into native frontmatter, caches them, and includes them on `sync`:

```bash
npx bluetemberg source add "github:PatrickJS/awesome-cursorrules#HEAD:rules"
npx bluetemberg sync
```

Sources are pinned in `llm/rule-sources.json` + `llm/rule-sources-lock.json` (commit both; run `bluetemberg source install` on a fresh clone) and are the lowest priority during sync, so your local rules always win. GitHub repos, PRPM packages, and cursor.directory plugins are all supported backends. See [Sources](https://github.com/prototypdigital/bluetemberg/wiki/Sources).

## Platform support

| Platform       | Rules | Agents | Skills |
| -------------- | ----- | ------ | ------ |
| Cursor         | ✓     | ✓      | ✓      |
| Claude Code    | ✓     | ✓      | ✓      |
| GitHub Copilot | ✓     | ✓      | ✓      |
| Gemini CLI     | ✓ ¹   | —      | —      |
| Windsurf       | ✓     | —      | ✓      |
| OpenAI Codex   | ✓ ²   | ✓ ²    | ✓      |

¹ Gemini CLI has no native rules API — rules are emitted as plain context files under `.gemini/context/` and prepended to the model context on each request. Agents and skills are not supported by the Gemini CLI extension at this time.

² Codex has no per-file rule API — rules are folded into a managed block in `AGENTS.md`, which Codex reads natively. Agents become per-file TOML under `.codex/agents/`, and skills go to the vendor-neutral `.agents/skills/`. See [the Codex mapping below](#how-sync-works).

## How sync works

| Source                  | Cursor                      | Claude                         | Copilot                                  | Gemini CLI             | Windsurf                      |
| ----------------------- | --------------------------- | ------------------------------ | ---------------------------------------- | ---------------------- | ----------------------------- |
| `llm/rules/*.md`        | `.cursor/rules/*.mdc`       | `.claude/rules/*.md`           | `.github/instructions/*.instructions.md` | `.gemini/context/*.md` | `.windsurf/rules/*.md`        |
| `llm/agents/*.md`       | `.cursor/agents/*.md`       | `.claude/agents/*.md`          | `.github/agents/*.agent.md`              | —                      | —                             |
| `llm/skills/*/SKILL.md` | `.cursor/skills/*/SKILL.md` | `.claude/skills/*/SKILL.md`    | `.github/skills/*/SKILL.md`              | —                      | `.windsurf/skills/*/SKILL.md` |
| `llm/mcp.json`          | `.cursor/mcp.json`          | `.claude/mcp.json`             | `.github/mcp.json`                       | —                      | —                             |
| `llm/commands/*.md`     | —                           | `.claude/commands/*.md`        | —                                        | —                      | `.windsurf/workflows/*.md`    |
| `llm/prompts/*.md`      | —                           | —                              | `.github/prompts/*.prompt.md`            | —                      | —                             |
| `AGENTS.md`             | —                           | —                              | `.github/copilot-instructions.md`        | `GEMINI.md`            | —                             |
| `llm/` (marketplace)    | —                           | `plugins/*/skills \| agents/`¹ | —                                        | —                      | —                             |

¹ Claude Code plugins have no native "rules" component, so the marketplace emitter converts each
rule into a `rule-{id}` skill — see [Marketplace](https://github.com/prototypdigital/bluetemberg/wiki/Marketplace).

Rules get platform-specific frontmatter transforms:

- **Cursor**: `scope: '**'` -> `alwaysApply: true`; otherwise `globs: [scope]`
- **Claude**: `paths: [scope]`
- **Copilot**: `applyTo: scope`
- **Gemini CLI**: `glob: scope`
- **Windsurf**: `scope: '**'` -> `trigger: always_on`; otherwise `trigger: glob`, `glob: scope`
- **OpenAI Codex**: none — Codex rules are plain markdown folded into `AGENTS.md` (see below)

Agents and skills are copied verbatim (only the filename extension changes).

**OpenAI Codex** consumes config differently from the table above — it reads `AGENTS.md` natively and uses TOML config rather than per-file rule directories:

| Source                  | Codex output                                                      |
| ----------------------- | ----------------------------------------------------------------- |
| `llm/rules/*.md`        | managed block in `AGENTS.md` (read natively — no per-rule files)  |
| `llm/agents/*.md`       | `.codex/agents/*.toml` (markdown body → `developer_instructions`) |
| `llm/skills/*/SKILL.md` | `.agents/skills/*/SKILL.md` (vendor-neutral; format unchanged)    |
| `llm/mcp.json`          | `[mcp_servers.*]` managed block in `.codex/config.toml`           |

`AGENTS.md` and `.codex/config.toml` are edited in place via fenced managed blocks, so hand-authored content outside the markers is preserved. When Copilot or Gemini are also enabled, the Codex rules block is stripped from their derived `copilot-instructions.md` / `GEMINI.md` (they receive scoped rules through their own directories). Codex subagents are limited to `name`, `description`, and `developer_instructions`; source-only fields like `tools` and `profiles` are not mapped.

**Monorepo and shared rule packs:** Add an `extends` field to `bluetemberg.config.json` to merge rules/agents/skills from additional source directories — relative paths (e.g. `"../../"` for the monorepo root) or npm package names (e.g. `"@company/ai-rules"`). Local files always take priority. See [Configuration](https://github.com/prototypdigital/bluetemberg/wiki/Configuration) for details.

**Programmatic API:** `import { sync, loadConfig, shouldExitWithFailure } from 'bluetemberg'`. `sync()` returns a **Promise** (it may load optional `adapters`). Always **await** it, e.g. `const results = await sync(root, { config: loadConfig(root), prune: true });`. Use `shouldExitWithFailure(results, checkMode)` to mirror CLI exit semantics. Release notes for each version live in [CHANGELOG.md](CHANGELOG.md) (updated by Release Please). Breaking changes should use conventional commits—see [Contributing — Changelog and breaking changes](https://github.com/prototypdigital/bluetemberg/wiki/Contributing#changelog-and-breaking-changes).

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
