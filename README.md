# Bluetemberg :light_blue_heart:

[![npm version](https://img.shields.io/npm/v/bluetemberg.svg)](https://www.npmjs.com/package/bluetemberg) [![CI](https://github.com/prototypdigital/bluetemberg/actions/workflows/ci.yml/badge.svg)](https://github.com/prototypdigital/bluetemberg/actions/workflows/ci.yml) [![license](https://img.shields.io/npm/l/bluetemberg.svg)](LICENSE)

**AI coding standards, shipped like a dependency. Version-locked, integrity-verified, signed, and routed to the right engineer and the right stack version. Installed with one command.**

A platform team maintains packs in [bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs). Developers run `bluetemberg init --non-interactive --profile frontend` + `bluetemberg install`. Teammates with no local tooling install a Claude Code Marketplace plugin with one click. Everyone stays in sync.

> Published on npm as [`bluetemberg`](https://www.npmjs.com/package/bluetemberg) — MIT licensed. Requires **Node.js 20+**.

**[prototypdigital.github.io/bluetemberg →](https://prototypdigital.github.io/bluetemberg/)** — install guide, pack browser, and docs.

**Supply-chain controls:** SHA-512 integrity and ECDSA registry signatures verified on every install. Registry host is pinned — metadata cannot redirect downloads to an attacker-controlled host. Tarballs are size-capped and path-traversal-filtered on extraction. See [SECURITY.md](SECURITY.md).

## "But everything is converging on AGENTS.md."

Good. That solves the format, not the distribution. Codex, Cursor, Copilot, Antigravity, Gemini CLI (once pointed at it) and Claude Code (when there's no `CLAUDE.md`, or one that imports it) all read `AGENTS.md`, and bluetemberg writes it for them.

A shared file still has no versioning, no integrity verification, no
per-role filtering, and no way to stop a Payload 2 rule from reaching a
Payload 3 repo. Bluetemberg emits `AGENTS.md` too. It also answers who
gets which rules, at which version, and how you know the content was not
tampered with in transit.

|                         | Shared `AGENTS.md`     | bluetemberg                                            |
| ----------------------- | ---------------------- | ------------------------------------------------------ |
| Versioning              | git history            | semver ranges + lockfile                               |
| Integrity verification  | none                   | SHA-512 + ECDSA registry signature per pack            |
| Per-role filtering      | manual copy-paste      | profiles (role-matched defaults)                       |
| Teammate onboarding     | clone + copy files     | `init --non-interactive --profile X` + `install`       |
| Zero-install onboarding | no                     | Claude Marketplace plugin                              |
| Scoping                 | one file per directory | each rule scoped by path in every tool's native format |
| Stack routing           | none                   | rules gated on the installed framework version         |

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

- **Team profile** — Frontend, Backend, Full-stack, DevOps / Platform, **pure-infra** (infrastructure-only repos), **agentic** (LLM-heavy / AI workflow projects), **design-engineer** (UI craft, design-to-code), or Custom — sets defaults for rules, agents, and skills (`--profile agentic` in headless runs)
- Target platforms (Cursor / Claude / Copilot / Gemini CLI Enterprise / Antigravity CLI / Devin Desktop (formerly Windsurf) / OpenAI Codex)
- **Stacks** — detected from the project and pre-checked (e.g. Payload 3.4.1, Next 15); drive which rules, agents and skills apply by version, written to config `stacks` (`--stacks payload@3.4.1,nextjs@auto` in headless runs)
- **Rule source** — versioned **rule collections** from the registry, or **empty** (bring your own rules / point at an external rule repo)
- Rule collections, agents and skills pre-selected by profile, with stack-specific packs pre-selected only when their stack is detected (see wiki **Profiles**)
- Specialist agents (frontend, test, docs, a11y, infra, security, devops)
- Skills (patterns, docs-upkeep, workspace-hygiene, code-review, api-design, etc.)
- MCP presets via `llm/mcp.json` → a merged root `.mcp.json` (Claude Code, VS Code, Copilot CLI), `.cursor/mcp.json` and the Codex `config.toml` block (interactive, context7, figma, github)
- **External rule sources** (optional) — pull rules from a GitHub repo, PRPM, or cursor.directory, translated to native format and pinned in `llm/rule-sources.json` (`--sources <csv>` in headless runs)
- **GitHub repository files** (optional) — Dependabot, issue/PR templates, CODEOWNERS, CONTRIBUTING, LICENSE, CODE_OF_CONDUCT, SECURITY. Bluetemberg never writes CI/CD workflows, and never overwrites a file that already exists (`--force` to replace; `--omit-github` to skip them in headless runs)

You can also add **`llm/hooks.json`** (Cursor hooks), **`llm/hooks.claude.json`** (Claude Code hooks — honored from the project's own `llm/` only; packs cannot ship them), **`llm/commands/*.md`** (Claude slash commands), **`llm/prompts/*.md`** (Copilot `*.prompt.md`), and optional **`adapters`** in `bluetemberg.config.json` for custom ESM emitters; see the wiki (_Writing Hooks_, _Writing Commands_, _Writing Prompts_, _Adapters_).

It scaffolds `llm/` as the vendor-neutral source of truth, generates platform-specific files, and patches `.prettierignore` to protect your prose files from the formatter.

## What it creates

```
your-project/
├── bluetemberg.config.json     # Platforms, targets, stacks, profile
├── AGENTS.md                   # Project context for AI tools (rules block appended if Codex or Gemini selected)
├── CLAUDE.md                   # `@AGENTS.md` import + Claude-specific notes (if Claude selected)
├── llm/
│   ├── packages.json           # Packs to install, with semver ranges — commit
│   ├── packages-lock.json      # Resolved versions + integrity hashes — commit
│   ├── rules/                  # Your own vendor-neutral rules
│   ├── agents/                 # Your own agent definitions
│   ├── skills/                 # Your own skill workflows
│   ├── guardrails/             # Optional — enforced hooks (Claude Code)
│   ├── mcp.json                # Optional — MCP presets and/or inline servers
│   ├── mcp-managed.json        # Generated — which .mcp.json servers sync owns; commit
│   ├── hooks.json              # Optional — Cursor hooks
│   ├── hooks.claude.json       # Optional — Claude Code hooks (project-local only)
│   ├── commands/               # Optional — Claude slash commands
│   └── prompts/                # Optional — Copilot prompt sources
├── .bluetemberg/packs/         # Installed pack cache — gitignored
├── .mcp.json                   # Managed servers only (Claude Code, VS Code, Copilot CLI) — the rest is yours
├── .cursor/rules/ agents/ skills/   # Generated — do not edit
├── .cursor/mcp.json, hooks.json     # Generated (Cursor) — do not edit
├── .claude/rules/ agents/ skills/ commands/   # Generated — do not edit
├── .claude/settings.json       # Generated keys only (`hooks`, marketplace) — the rest is yours
├── .github/instructions/ agents/ skills/ prompts/   # Generated — do not edit
├── .github/copilot-instructions.md  # Copy of AGENTS.md for Copilot — do not edit
├── .gemini/settings.json       # `context.fileName` gains `AGENTS.md` (Gemini) — the rest is yours
├── .devin/rules/               # Generated (Devin Desktop) — do not edit
├── .windsurf/rules/            # Generated legacy mirror of .devin/rules/ (transition period) — do not edit
├── .agents/skills/             # Generated (Codex + Devin Desktop + Antigravity skills, vendor-neutral) — do not edit
├── .agents/rules/              # Generated (Antigravity) — do not edit
├── .agents/mcp_config.json     # Generated servers merged by name (Antigravity) — the rest is yours
├── .codex/agents/              # Generated (Codex subagents, TOML) — do not edit
└── .codex/config.toml          # Generated MCP block (Codex) — managed section only
```

Only `.bluetemberg/` is gitignored. Generated output is meant to be committed, so teammates and CI see exactly what the tools load and `sync --check` can verify it.

Every generated Markdown and TOML file carries that warning **in the file itself**, right after its frontmatter — rules, agents, skills, commands, Copilot prompts, Codex agents, marketplace plugin content, and the `copilot-instructions.md` copy of `AGENTS.md`. JSON outputs can't carry a comment, so `mcp.json` and the marketplace manifests are the exception (in `.mcp.json`, `llm/mcp-managed.json` records which servers are bluetemberg's):

```md
<!-- Generated by bluetemberg from rules/no-console-log.md. Do not edit — run `bluetemberg sync` after editing the source. -->
```

A `.gitignore` entry and a comment in this tree only help someone reading the repo root. The banner travels with the file, so an editor who opens `.claude/rules/x.md` directly — or an agent that greps into it — sees that edits there are disposable and where the real source is. This matters most in projects that **commit** their generated output so `sync --check` can verify parity in CI: generated and hand-authored markdown then sit side by side, otherwise indistinguishable.

When `claude-marketplace` is in `platforms`, sync also generates:

```
.claude-plugin/
└── marketplace.json            # Root manifest listing all plugins
plugins/
└── <plugin-name>/              # One directory per plugin defined in marketplace.plugins
```

Official Bluetemberg plugin packs (frontend, fullstack, backend, devops) are served from [prototypdigital/claude-marketplace](https://github.com/prototypdigital/claude-marketplace), generated from [bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs) content — add them with `/plugin marketplace add prototypdigital/claude-marketplace`. See [Marketplace](https://github.com/prototypdigital/bluetemberg/wiki/Marketplace).

## Packs

Rules, agents, skills and guardrails ship as versioned npm packs from [bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs). Browse all of them, with their profiles and stacks, in the **[pack browser](https://prototypdigital.github.io/bluetemberg-packs/)**. The wiki's [Profiles](https://github.com/prototypdigital/bluetemberg/wiki/Profiles) page shows what each profile pre-selects; `npx bluetemberg preview <profile>` prints the same list with current versions.

Git, Security and Docs rules and the docs-maintainer agent are pre-selected for every profile except Custom.

After `init`, run `bluetemberg install` to download the packs listed in `llm/packages.json` into the local cache (`.bluetemberg/packs/`); `sync` merges them with your local `llm/` content. Use `bluetemberg install --dry-run` to preview what would be installed without writing anything to disk.

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

Packs can also come from a **private registry** — a private scope on npmjs.org, GitHub Packages, Verdaccio, Artifactory. Credentials are read from `.npmrc` or `NPM_TOKEN`/`NODE_AUTH_TOKEN` exactly as npm reads them, and are only ever sent to the host they are scoped to, over https. Registries that do not sign need an explicit opt-in:

```bash
NODE_AUTH_TOKEN=... npx bluetemberg install --skip-signature-verification
```

Signature verification stays mandatory for `registry.npmjs.org`. See [Private registries](https://github.com/prototypdigital/bluetemberg/wiki/Registry#private-registries).

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

`sync` detects the project's stacks (declared version → `node_modules` → lockfile → coerced `package.json` range), then hard-excludes rules, guardrails, agents, and skills whose range the detected version doesn't satisfy — listing what it filtered so you can audit it. Content with no `stacks:` is stack-agnostic and always applies, so projects that declare no stacks behave exactly as before.

Inspect detection and coverage — these have a `--json` twin for agents:

```bash
npx bluetemberg detect              # detected stacks, versions, confidence, gaps
npx bluetemberg coverage payload@3  # is there version-correct guidance for this stack?
```

Or expose the same model to an agent as MCP tools (`bluetemberg_detect_stacks`, `bluetemberg_query_coverage`, `bluetemberg_list_stacks`, `bluetemberg_org_histogram`) — read-only, over stdio:

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

## Guardrails

Rules are advice an assistant can skip. Guardrails are not: a guardrail is a declarative check that `sync` compiles into a hook the platform runs before the tool call, so a violating call is blocked.

```yaml
# llm/guardrails/conventional-branch-names.md frontmatter
trigger: EnterWorktree
check:
  field: name
  not_empty: true
  not_matches: '^claude/'
message: 'EnterWorktree requires a conventional branch name (type/description).'
```

Guardrails compile to Claude Code hooks in `.claude/settings.json` today; other platforms don't run them. The `bluetemberg-guardrails-git` pack blocks auto-generated worktree branch names; `init --non-interactive` adds it, and in the interactive wizard you add it with `bluetemberg add bluetemberg-guardrails-git`. See [Guardrails](https://github.com/prototypdigital/bluetemberg/wiki/Guardrails).

## Sync

After editing anything in `llm/`, regenerate platform files:

```bash
npx bluetemberg sync
```

In a monorepo, sync is **recursive by default**: it finds every `bluetemberg.config.json` at or below the current directory and syncs each package against its own detected stacks. Pass `--no-recursive` to sync only the current directory.

Check mode for CI (exits 1 if out of sync):

```bash
npx bluetemberg sync --check
```

Add `--diff` to see _what_ drifted, not just how many files — a per-file unified diff (summary counts + `@@` hunks) under each out-of-sync path. It implies `--check`, honors `--silent`, and never changes counts or the exit code:

```bash
npx bluetemberg sync --check --diff
```

**Exit codes:** the CLI exits **1** if sync records **any** error (invalid `llm/hooks.json`, unknown MCP id, adapter failure, etc.), not only when `--check` finds drift. Use the exit code in CI, especially with `--silent`.

`--check` also reports generated files that no source produces any more (a deleted or renamed rule, or one a stack change filtered out) as `STALE:`, so CI never stays green over output the tools are still loading. Remove them with **`--prune`**:

```bash
npx bluetemberg sync --prune
```

`--prune` deletes only files that carry the generated-file banner. A hand-written file in a managed directory, or a JSON output (which can't carry a banner), is kept and listed; a dropped marketplace plugin whose files all carry the banner is removed whole. `--prune` is ignored with `--check`. See the wiki ([Commands](https://github.com/prototypdigital/bluetemberg/wiki/Commands), [Configuration](https://github.com/prototypdigital/bluetemberg/wiki/Configuration)) for exit codes, `.gitattributes`, and prune caveats.

## External sources

Pull rules from outside the npm pack registry — e.g. a community GitHub repo of `.cursorrules`/`.mdc` files — and Bluetemberg translates them into native frontmatter, caches them, and includes them on `sync`:

```bash
npx bluetemberg source add "github:PatrickJS/awesome-cursorrules#HEAD:rules"
npx bluetemberg sync
```

Sources are pinned in `llm/rule-sources.json` + `llm/rule-sources-lock.json` (commit both; run `bluetemberg source install` on a fresh clone) and are the lowest priority during sync, so your local rules always win. GitHub repos, PRPM packages, and cursor.directory plugins are all supported backends. See [Sources](https://github.com/prototypdigital/bluetemberg/wiki/Sources).

## Platform support

| Platform        | Rules | Agents | Skills |
| --------------- | ----- | ------ | ------ |
| Cursor          | ✓     | ✓      | ✓      |
| Claude Code     | ✓     | ✓      | ✓      |
| GitHub Copilot  | ✓     | ✓      | ✓      |
| Gemini CLI ¹    | ✓ ¹   | —      | —      |
| Antigravity     | ✓     | —      | ✓      |
| Devin Desktop ³ | ✓     | —      | ✓      |
| OpenAI Codex    | ✓ ²   | ✓ ²    | ✓      |

¹ `gemini` targets **Gemini CLI for Enterprise** (Gemini Code Assist Standard / Enterprise). Google stopped serving Gemini CLI to free and individual paid users on 2026-06-18 and replaced it with Antigravity CLI, so pick `antigravity` for those. Gemini CLI loads only the context files named by `context.fileName` and has no per-path rules, so sync adds `AGENTS.md` to `context.fileName` in `.gemini/settings.json` (leaving every other setting alone) and folds rules into the managed block in `AGENTS.md`, as for Codex. Agents and skills are not emitted for Gemini CLI.

² Codex has no per-file rule API — rules are folded into a managed block in `AGENTS.md`, which Codex reads natively. Only Codex and Gemini CLI get that block. Every other platform receives scoped rules through its own directory, and most of them also read `AGENTS.md`, so folding rules in for them would load each rule twice. Agents become per-file TOML under `.codex/agents/`, and skills go to the vendor-neutral `.agents/skills/`. See [the Codex mapping below](#how-sync-works).

³ Devin Desktop is the former Windsurf (renamed 2026-06-02). Use the platform id `devin`; `windsurf` is still accepted as an alias and behaves identically. Rules go to `.devin/rules/` and, for a transition period, are mirrored to the legacy `.windsurf/rules/` that Devin still reads — the mirror will be dropped in a later release. Skills go to `.agents/skills/`, which Devin shares with Codex and Antigravity (written once). Devin deprecated workflows in favor of skills, so `llm/commands/` no longer emits `.windsurf/workflows/`; run `bluetemberg sync --prune` once to remove the old generated `.windsurf/workflows/` and `.windsurf/skills/` files.

## How sync works

| Source               | Cursor                | Claude                         | Copilot                                  | Gemini CLI                                            | Antigravity               | Devin Desktop                                 |
| -------------------- | --------------------- | ------------------------------ | ---------------------------------------- | ----------------------------------------------------- | ------------------------- | --------------------------------------------- |
| `llm/rules/*.md`     | `.cursor/rules/*.mdc` | `.claude/rules/*.md`           | `.github/instructions/*.instructions.md` | managed block in `AGENTS.md`                          | `.agents/rules/*.md`      | `.devin/rules/*.md` + `.windsurf/rules/*.md`² |
| `llm/agents/*.md`    | `.cursor/agents/*.md` | `.claude/agents/*.md`          | `.github/agents/*.agent.md`              | —                                                     | —                         | —                                             |
| `llm/skills/*/`      | `.cursor/skills/*/`   | `.claude/skills/*/`            | `.github/skills/*/`                      | —                                                     | `.agents/skills/*/`       | `.agents/skills/*/`                           |
| `llm/mcp.json`       | `.cursor/mcp.json`    | `.mcp.json` (merged)           | `.mcp.json` (merged)                     | —                                                     | `.agents/mcp_config.json` | —                                             |
| `llm/commands/*.md`  | —                     | `.claude/commands/*.md`        | —                                        | —                                                     | —                         | —                                             |
| `llm/prompts/*.md`   | —                     | —                              | `.github/prompts/*.prompt.md`            | —                                                     | —                         | —                                             |
| `AGENTS.md`          | —                     | —                              | `.github/copilot-instructions.md`        | read via `.gemini/settings.json` (`context.fileName`) | read natively             | —                                             |
| `llm/` (marketplace) | —                     | `plugins/*/skills \| agents/`¹ | —                                        | —                                                     | —                         | —                                             |

¹ Claude Code plugins have no native "rules" component, so the marketplace emitter converts each
rule into a `rule-{id}` skill — see [Marketplace](https://github.com/prototypdigital/bluetemberg/wiki/Marketplace).

² `.windsurf/rules/` is a transitional mirror for Devin builds that still read the legacy path; it will be dropped in a later release.

Rules get platform-specific frontmatter transforms:

- **Cursor**: `scope: '**'` -> `alwaysApply: true`; otherwise `globs: [scope]`
- **Claude**: `paths: [scope]`
- **Copilot**: `applyTo: scope`
- **Gemini CLI**: none — rules are plain markdown in the `AGENTS.md` managed block, like Codex
- **Devin Desktop** and **Antigravity**: `scope: '**'` -> `trigger: always_on`; otherwise `trigger: glob`, `globs: scope`
- **OpenAI Codex**: none — Codex rules are plain markdown folded into `AGENTS.md` (see below)

Agents and skills keep their body unchanged. Sync adds the generated-file banner, changes the filename extension, and for Claude Code maps the abstract `tools` names in agent frontmatter to Claude's tool names.

**Claude Code and `AGENTS.md`:** Claude Code reads `AGENTS.md` natively (v2.1.277+), but only when there is no `CLAUDE.md`. Once a `CLAUDE.md` exists, `AGENTS.md` is ignored unless the `CLAUDE.md` imports it. That is why the scaffolded `CLAUDE.md` starts with `@AGENTS.md`, the pattern Anthropic recommends. `sync` warns when a root `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` would hide `AGENTS.md` this way. See [Architecture](https://github.com/prototypdigital/bluetemberg/wiki/Architecture#claude-code-and-agentsmd).

**OpenAI Codex** consumes config differently from the table above — it reads `AGENTS.md` natively and uses TOML config rather than per-file rule directories:

| Source            | Codex output                                                            |
| ----------------- | ----------------------------------------------------------------------- |
| `llm/rules/*.md`  | managed block in `AGENTS.md` (read natively — no per-rule files)        |
| `llm/agents/*.md` | `.codex/agents/*.toml` (markdown body → `developer_instructions`)       |
| `llm/skills/*/`   | `.agents/skills/*/` (vendor-neutral; whole directory, format unchanged) |
| `llm/mcp.json`    | `[mcp_servers.*]` managed block in `.codex/config.toml`                 |

`AGENTS.md` and `.codex/config.toml` are edited in place via fenced managed blocks, so hand-authored content outside the markers is preserved. The same rules block serves Gemini CLI. When Copilot is also enabled, the block is stripped from its derived `copilot-instructions.md` (Copilot receives scoped rules through `.github/instructions/`). Codex subagents are limited to `name`, `description`, and `developer_instructions`; source-only fields like `tools` and `profiles` are not mapped.

**Monorepo and shared rule packs:** Add an `extends` field to `bluetemberg.config.json` to merge rules/agents/skills from additional source directories — relative paths (e.g. `"../../"` for the monorepo root) or npm package names (e.g. `"@company/ai-rules"`). Local files always take priority. See [Configuration](https://github.com/prototypdigital/bluetemberg/wiki/Configuration) for details.

**Programmatic API (unstable before 1.0):** `import { sync, loadConfig, shouldExitWithFailure } from 'bluetemberg'`. The CLI is the supported interface; exported functions and types may change in a minor release until 1.0. `sync()` returns a **Promise** (it may load optional `adapters`). Always **await** it, e.g. `const results = await sync(root, { config: loadConfig(root), prune: true });`. Use `shouldExitWithFailure(results, checkMode)` to mirror CLI exit semantics. Release notes for each version live in [CHANGELOG.md](CHANGELOG.md) (updated by Release Please). Breaking changes should use conventional commits—see [Contributing — Changelog and breaking changes](https://github.com/prototypdigital/bluetemberg/wiki/Contributing#changelog-and-breaking-changes).

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

When `remote` is set, `bluetemberg sync` writes `extraKnownMarketplaces` and `enabledPlugins` to `.claude/settings.json` — Claude Code then auto-prompts teammates to install the relevant plugin when they open the project. **Teammates need no local bluetemberg install.**

See [docs/wiki/Marketplace.md](docs/wiki/Marketplace.md) for the full setup guide.

## Uninstall

1. Empty `llm/packages.json` (`{ "packages": {} }`) and delete any local sources under `llm/` you no longer want synced. Keep `llm/mcp-managed.json` until step 2 has run: it is how sync knows which `.mcp.json` servers are its own to remove.
2. Run `npx bluetemberg sync --prune`. It deletes every generated file that carries the banner and removes the guardrail hooks it added to `.claude/settings.json`.
3. Delete what's left by hand:
   - `bluetemberg.config.json`, `llm/` and `.bluetemberg/`
   - the JSON outputs: `.cursor/mcp.json`, `.cursor/hooks.json` (sync already removed its own servers from `.mcp.json` once `llm/mcp.json` was gone)
   - `.github/copilot-instructions.md` (a copy of `AGENTS.md`)
   - the `AGENTS.md` entry in `context.fileName` of `.gemini/settings.json`, and the servers sync added to `.agents/mcp_config.json`
   - the `BLUETEMBERG MANAGED` block in `.codex/config.toml`
   - `extraKnownMarketplaces` / `enabledPlugins` in `.claude/settings.json`, if you used a marketplace remote
   - the `.bluetemberg/` line in `.gitignore` and the `llm/` / `docs/wiki/` lines in `.prettierignore`
4. `npm uninstall bluetemberg`.

`AGENTS.md`, `CLAUDE.md` and the GitHub files `init` scaffolded are ordinary files you own; keep or delete them.

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
- [Stacks & Versioning](https://github.com/prototypdigital/bluetemberg/wiki/Stacks)
- [Guardrails](https://github.com/prototypdigital/bluetemberg/wiki/Guardrails)
- [Registry](https://github.com/prototypdigital/bluetemberg/wiki/Registry)
- [External Sources](https://github.com/prototypdigital/bluetemberg/wiki/Sources)
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

## Maintainer

Bluetemberg is written and maintained by
[Josip Ravas](https://github.com/jravas) — DevOps & Architecture Lead at
PROTOTYP.

Issues and pull requests welcome. For anything security-related, see
[SECURITY.md](./SECURITY.md).
