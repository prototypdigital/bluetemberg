# Configuration

Bluetemberg stores project settings in `bluetemberg.config.json` at the repository root. This file is created by `bluetemberg init` and read by `bluetemberg sync`.

## Schema

```json
{
  "platforms": ["cursor", "claude", "copilot"],
  "source": "llm",
  "stacks": { "payload": "3.4.1", "nextjs": "auto" },
  "extends": ["../../"],
  "targets": {
    "rules": {
      "cursor": { "dir": ".cursor/rules", "ext": ".mdc" },
      "claude": { "dir": ".claude/rules", "ext": ".md" },
      "copilot": { "dir": ".github/instructions", "ext": ".instructions.md" }
    },
    "agents": {
      "cursor": { "dir": ".cursor/agents", "ext": ".md" },
      "claude": { "dir": ".claude/agents", "ext": ".md" },
      "copilot": { "dir": ".github/agents", "ext": ".agent.md" }
    },
    "skills": {
      "cursor": { "dir": ".cursor/skills" },
      "claude": { "dir": ".claude/skills" },
      "copilot": { "dir": ".github/skills" }
    }
  },
  "adapters": ["@your-scope/your-bluetemberg-adapter"]
}
```

The `stacks`, `extends`, `adapters`, and `root` fields are optional.

## Fields

### `platforms`

Array of target platforms. Valid values: `"cursor"`, `"claude"`, `"copilot"`, `"gemini"`, `"windsurf"`, `"codex"`, `"claude-marketplace"`.

Only selected platforms get generated output during sync.

`"claude-marketplace"` emits a plugin bundle under `plugins/` and `.claude-plugin/` that can be installed by teammates via `/plugin marketplace add owner/repo`. See [Marketplace](Marketplace).

### `source`

Directory name containing vendor-neutral sources. Default: `"llm"`.

The sync engine reads from `<source>/rules/`, `<source>/agents/`, `<source>/skills/`, and optionally `<source>/mcp.json`, `<source>/hooks.json`, `<source>/hooks.claude.json`, `<source>/commands/`, and `<source>/prompts/` (see [Adapters](Adapters)).

### `stacks`

Optional map of **technology stack → version**, declaring which frameworks (and which versions) the project builds on. This is the project-level half of the **stacks axis** — orthogonal to `profile` (role). It drives version-aware rule routing: at sync, a rule or guardrail whose `stacks:` constraint targets a version the project does not use is hard-excluded (see [Writing Rules](Writing-Rules)).

```json
{
  "stacks": {
    "payload": "3.4.1",
    "nextjs": "auto"
  }
}
```

| Value | Meaning |
|-------|---------|
| Pinned version (`"3.4.1"`) | Asserted as fact, matched directly against rule ranges. Cheap and deterministic — the default. |
| `"auto"` | Re-detect this stack every sync from `node_modules` / lockfile / `package.json`. |
| (omitted) | The stack is still auto-detected if its package is a dependency; declare it here only to pin a version or surface it in `bluetemberg detect`. |

Stack names are an **open vocabulary** — adding a framework never requires an engine release. The known stack→package mappings (e.g. `nextjs` → `next`, `angular` → `@angular/core`) are used for auto-detection; unknown names map to themselves. A version declared here is never persisted with a confidence level — confidence is a property of *detection* and is surfaced live by `bluetemberg detect`.

`bluetemberg init` populates this field via a **detect-then-confirm** step (detected stacks pre-checked, with free-text adds), or pass `--stacks` in headless runs; you can also edit it by hand. Inspect what the engine resolves with [`bluetemberg detect`](Commands#bluetemberg-detect-directory). `llm/` remains the source of truth; this field only routes existing content.

See [Stacks & Versioning](Stacks) for the full model: detection precedence and confidence, the hard-exclude gate, the audible filtering output, and the versioning strategy.

### `extends`

Optional string or array of strings that point to **additional source directories** to merge with the local `source` directory. Extended sources supply rules, agents, and skills that your local `source` dir does not define; when the same filename exists in both, the **local file wins**.

Supported formats:

| Format | Example | Resolved as |
|--------|---------|-------------|
| Relative path | `"../../"` | Sibling directory (monorepo root). Bluetemberg looks for `<path>/llm/` first, then `<path>` itself. |
| Absolute path | `"/shared/ai-rules"` | Same resolution as relative. |
| npm package name | `"@company/ai-rules"` | `node_modules/@company/ai-rules/llm/`, falling back to `node_modules/@company/ai-rules/`. |

```json
{
  "extends": ["../../"],
  "platforms": ["cursor", "claude"],
  "source": "llm"
}
```

**Priority:** The local `source` directory always has the highest priority. If `extends` is an array, earlier entries have higher priority than later ones.

**Monorepo use case:** Place shared rules in the repo root's `llm/` directory, then have each package extend the root:

```
my-monorepo/
  llm/rules/coding-standards.md   ← shared
  packages/
    frontend/
      bluetemberg.config.json     ← "extends": ["../../"]
      llm/rules/react-patterns.md ← local override
    backend/
      bluetemberg.config.json     ← "extends": ["../../"]
```

**Shared npm rule pack use case:** Publish an npm package containing a `llm/` directory, install it, then reference it in `extends`.

### `marketplace`

Optional. Only used when `"claude-marketplace"` is in `platforms`. Controls how `llm/` content maps to installable plugins:

```json
{
  "marketplace": {
    "remote": "prototypdigital/claude-marketplace",
    "plugins": [
      {
        "name": "frontend",
        "displayName": "Frontend Developer",
        "description": "Rules and skills for React/TypeScript projects",
        "profiles": ["frontend", "fullstack"]
      }
    ]
  }
}
```

- `remote` — `owner/repo` of the dedicated marketplace repo. When set, `bluetemberg sync` writes `extraKnownMarketplaces` into `.claude/settings.json` so Claude Desktop auto-prompts teammates to install plugins.
- `plugins` — when omitted, a single plugin named after the project directory is emitted.

See [Marketplace](Marketplace) for the full schema, profile filtering behavior, and CI workflow setup.

### `adapters`

Optional array of **strings** passed to `import()`: npm package names (must be installed in the consumer project), `file:` URLs, or absolute `file://` URLs. Loaded **after** all built-in steps. Specifiers execute code at sync time — use only **trusted** modules; see [Adapters](Adapters) for the module contract and security notes.

### `root`

Optional boolean. When `true`, marks this config as the **inheritance root** in a monorepo: config discovery stops here and never looks at ancestor `bluetemberg.config.json` files above this directory. Defaults to `false`. See [Monorepo config inheritance](#monorepo-config-inheritance).

### `targets`

Maps each content type (rules, agents, skills) to platform-specific output directories and file extensions.

Invalid `targets` shapes (wrong types, unknown platform keys, empty `dir` / missing `ext` for rules and agents) cause **`bluetemberg sync` to fail at config load** with a clear error. Omit a section entirely if you do not use that content type.

#### Line endings and `--check`

On Windows, Git may checkout files with CRLF. Check mode compares normalized line endings (CRLF vs LF is ignored) so CI is less likely to report false drift. You can still enforce LF for generated paths in `.gitattributes`, for example:

```
.cursor/rules/** text eol=lf
.cursor/agents/** text eol=lf
.cursor/skills/** text eol=lf
.claude/** text eol=lf
.github/instructions/** text eol=lf
.github/agents/** text eol=lf
.github/skills/** text eol=lf
.github/prompts/** text eol=lf
.github/copilot-instructions.md text eol=lf
```

Adjust the list to match the platforms and directories you use.

#### Generated-file banner

Generated rules, agents, skills, and commands carry a banner immediately after their frontmatter naming the source they came from:

```md
<!-- Generated by bluetemberg from rules/no-console-log.md. Do not edit — run `bluetemberg sync` after editing the source. -->
```

Sources under `llm/` never carry one — it is added on the way out, and re-running sync replaces rather than stacks it. The banner is what makes "this file is disposable" visible to whoever opens the output directly, rather than only to whoever reads the `.gitignore`.

**Upgrading:** the banner changes the bytes of every generated rule/agent/skill/command, so the first `sync --check` after upgrading reports drift for all of them. Run `bluetemberg sync` once and commit the result. Projects that gitignore their generated output have nothing to commit and nothing to do.

#### Stale generated files (`sync --prune`)

Sync normally **only writes**; it does not delete old outputs when you remove or rename a source file under `llm/`. Run **`bluetemberg sync --prune`** after editing sources to remove generated files that are no longer part of the current plan (under the same managed directories the built-in sync writes to).

**Caveats:** `--prune` runs only after a write pass with **no recorded errors**. It does not delete files your **adapters** create unless those adapters record outputs via `commitPlannedWrite` and pass through `expectedOutputPaths` from the adapter context (see [Adapters](Adapters)). Hand-edited copies under managed dirs may be removed if they are not regenerated. **Do not** point `targets.*.*.dir` at a directory that contains unrelated files you care about.

**Before you `--prune`:**

- Commit or stash so you can revert if something unexpected is removed.
- Confirm each `targets.*.*.dir` is **only** for Bluetemberg-generated files (not a shared docs or src tree).
- If you use **adapters**, ensure they register outputs with `commitPlannedWrite` and the sink’s `expectedOutputPaths` when pruning (see [Adapters](Adapters)).

**Disabled platforms:** Prune only scans outputs for **platforms listed in `platforms`**. Removing a platform from config does **not** delete its old generated files (for example a leftover `.claude/mcp.json` after you drop `"claude"`). Delete those paths manually or temporarily re-enable the platform and run a normal write + `--prune` if the files still match the built-in layout.

#### Rules targets

| Platform | Default dir            | Default ext        |
| -------- | ---------------------- | ------------------ |
| cursor   | `.cursor/rules`        | `.mdc`             |
| claude   | `.claude/rules`        | `.md`              |
| copilot  | `.github/instructions` | `.instructions.md` |
| windsurf | `.windsurf/rules`      | `.md`              |

#### Agent targets

| Platform | Default dir      | Default ext |
| -------- | ---------------- | ----------- |
| cursor   | `.cursor/agents` | `.md`       |
| claude   | `.claude/agents` | `.md`       |
| copilot  | `.github/agents` | `.agent.md` |

#### Skill targets

| Platform | Default dir        |
| -------- | ------------------ |
| cursor   | `.cursor/skills`   |
| claude   | `.claude/skills`   |
| copilot  | `.github/skills`   |
| windsurf | `.windsurf/skills` |
| codex    | `.agents/skills`   |

Skills are synced as `<skill-name>/SKILL.md` within the target directory.

> Codex rules, agents, and MCP do **not** use the `targets` tables above — they have fixed,
> non-per-file outputs. See [OpenAI Codex](#openai-codex-codex) below. Only `targets.skills.codex`
> is configurable.

## Monorepo config inheritance

In a monorepo, each package can have its own `bluetemberg.config.json` that **inherits from a root config**. When you run `bluetemberg sync` from a package directory, Bluetemberg walks **up** the directory tree, collects every `bluetemberg.config.json` it finds, and merges them — with the most-local file winning on conflicts.

> **Run it once from the root.** `bluetemberg sync` is **recursive by default**: from any directory it discovers every `bluetemberg.config.json` at or below that point and syncs each configured package against its own merged config and detected stacks (the config tree is the workspace map — no npm/pnpm/yarn workspace globs to maintain). One sync, or one `sync --check` in CI, keeps the whole workspace correct. A repo with no sub-package configs is unaffected. Pass [`--no-recursive`](Commands#bluetemberg-sync-directory) to sync only the current directory.

```
my-monorepo/
  bluetemberg.config.json       # root — shared platforms, targets
  packages/
    frontend/
      bluetemberg.config.json   # inherits root, adds frontend-specific values
    backend/
      bluetemberg.config.json   # inherits root, adds backend-specific values
```

### How discovery and merging work

1. Starting from the directory you run sync in, Bluetemberg looks for `bluetemberg.config.json` in that directory and each parent.
2. Traversal **stops** after the first of: a config with `"root": true`, the git root (a directory containing `.git`), or the filesystem root. The stopping directory's own config is still included.
3. Configs are merged from the outermost ancestor inward, so **local values win**.

### Merge semantics

| Field | Behavior |
|-------|----------|
| `platforms` | **Unioned** across the chain (ancestor entries first), deduped. |
| `targets` | **Deep-merged per platform.** A local entry overriding only `dir` keeps the inherited `ext`. |
| `extends` | **Unioned**, with local entries taking priority (placed first), deduped. |
| `stacks` | **Merged** as an object; local versions override inherited ones. |
| `adapters` | **Unioned** (local first), deduped. |
| `source` | **Never inherited** — always the local package's value (or the default `llm`). |
| `profile`, `marketplace` | Local value replaces the inherited one. |

Because fields can be inherited, an individual package config may **omit** `platforms` (or partial `targets` fields) as long as an ancestor supplies them. The **merged** result must still be valid — if no config in the chain defines `platforms`, sync fails with the usual error.

### Stopping inheritance with `root`

Set `"root": true` in a config to stop discovery from climbing past it — useful when a monorepo lives inside a larger directory that also contains a `bluetemberg.config.json`:

```json
{
  "root": true,
  "platforms": ["cursor", "claude"],
  "source": "llm",
  "targets": {}
}
```

> **Not the same as [`extends`](#extends).** `extends` merges **source directories** (`llm/` rules, agents, skills) from other locations. Config inheritance merges the **config file itself** (platforms, targets, stacks, …). The two are independent and can be used together — e.g. a package config can both inherit a root config *and* declare its own `extends`.

## MCP manifest (`llm/mcp.json`)

When this file exists, sync regenerates platform-specific MCP config:

| Platform | Output file         | JSON shape                          |
| -------- | ------------------- | ----------------------------------- |
| claude   | `.claude/mcp.json`  | `{ "mcpServers": { ... } }`         |
| copilot  | `.github/mcp.json`  | `{ "servers": { ... } }`            |
| cursor   | `.cursor/mcp.json`  | `{ "mcpServers": { ... } }`         |

The manifest is vendor-neutral. The `servers` array may contain:

1. **Strings** — preset ids built into Bluetemberg (the same ids offered during `bluetemberg init`, e.g. `interactive`, `context7`, `figma`, `github`). Unknown ids are reported as sync errors; any successfully resolved entries are still emitted.
2. **Objects** — inline server definitions that **do not** need a preset. Each object must include `id` (string, used as the key in the output map) and `type` (string). Optional fields: `command`, `args` (array of strings), `url` — same shape as the built-in preset entries.

```json
{
  "servers": [
    "interactive",
    {
      "id": "my-cli",
      "type": "stdio",
      "command": "node",
      "args": ["./tools/mcp.mjs"]
    }
  ]
}
```

Built-in presets are **convenience defaults**; vendors may change URLs or package names. Prefer **inline** objects when you need a fixed command, URL, or version without waiting for a Bluetemberg release.

After changing `mcp.json`, run `bluetemberg sync` (or your `sync:llm-config` script).

## Cursor hooks (`llm/hooks.json`)

When this file exists and **`cursor`** is in `platforms`, sync writes **`.cursor/hooks.json`** with the same logical content (validated JSON). See [Writing Hooks](Writing-Hooks).

## Claude Code hooks (`llm/hooks.claude.json`)

When this file exists and **`claude`** is in `platforms`, sync validates it (whitelisted events, `"type": "command"` hooks only) and merges it into the `hooks` key of **`.claude/settings.json`**, composed with any [Guardrails](Guardrails)-generated entries. **Security boundary:** the file is honored only from the project's own `<source>/` directory — a `hooks.claude.json` shipped by an installed pack or an `extends` source is skipped with a warning, so third-party packs can never inject shell hooks. See [Writing Hooks](Writing-Hooks).

## Claude commands (`llm/commands/`)

Markdown files in this directory (except `README.md`) are copied to **`.claude/commands/`** when **`claude`** is in `platforms`. See [Writing Commands](Writing-Commands).

## Copilot prompt files (`llm/prompts/`)

Markdown files here are copied to **`.github/prompts/`** with the `*.prompt.md` suffix Copilot expects when **`copilot`** is in `platforms`. See [Writing Prompts](Writing-Prompts).

## OpenAI Codex (`codex`)

Codex reads `AGENTS.md` natively and uses TOML configuration, so it does not follow the per-file rule/agent target tables above. When `"codex"` is in `platforms`, sync produces:

| Source                  | Output                                  | Notes                                                                                       |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `llm/rules/*.md`        | managed block in `AGENTS.md`            | Plain markdown — **no** frontmatter transform. Fenced between markers; hand-authored content is preserved. |
| `llm/agents/*.md`       | `.codex/agents/<name>.toml`             | Markdown body → `developer_instructions`; only `name` + `description` carry over.            |
| `llm/skills/*/SKILL.md` | `.agents/skills/<name>/SKILL.md`        | Vendor-neutral path; format unchanged. Configurable via `targets.skills.codex`.             |
| `llm/mcp.json`          | `[mcp_servers.*]` in `.codex/config.toml` | Fenced managed block; hand-authored config preserved.                                       |

`AGENTS.md` and `.codex/config.toml` are edited in place via managed blocks, so they are **not** removed by `--prune` (the generated `.codex/agents/*.toml` files **are** pruned). If `copilot` or `gemini` are also enabled, the Codex rules block is stripped from their derived `copilot-instructions.md` / `GEMINI.md`, since those platforms receive scoped rules through their own directories.

## Default behavior

If `bluetemberg.config.json` does not exist, `bluetemberg sync` uses defaults: all three platforms, `llm` as source directory, and standard target paths.
