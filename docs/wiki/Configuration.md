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

Array of target platforms. Valid values: `"cursor"`, `"claude"`, `"copilot"`, `"gemini"`, `"antigravity"`, `"devin"`, `"codex"`, `"claude-marketplace"`.

`"gemini"` is **Gemini CLI for Enterprise**: Google stopped serving Gemini CLI to free and individual paid users on 2026-06-18, and `"antigravity"` (Antigravity CLI) is its successor. See [Gemini CLI](#gemini-cli-gemini) and [Antigravity CLI](#antigravity-cli-antigravity) below.

`"devin"` is Devin Desktop, formerly Windsurf. The old id `"windsurf"` is still accepted as an alias and behaves identically, so existing configs keep working; `init` now writes `"devin"`. A `targets.<kind>.windsurf` entry is read as the `devin` entry, and one that still points at the old default (`.windsurf/rules`, `.windsurf/skills`) picks up the new Devin default instead. See [Devin Desktop](#devin-desktop-devin) below.

Only selected platforms get generated output during sync.

`"claude-marketplace"` emits a plugin bundle under `plugins/` and `.claude-plugin/` that can be installed by teammates via `/plugin marketplace add owner/repo`. See [Marketplace](Marketplace).

### `source`

Directory name containing vendor-neutral sources. Default: `"llm"`.

The sync engine reads from `<source>/rules/`, `<source>/agents/`, `<source>/skills/`, and optionally `<source>/mcp.json`, `<source>/hooks.json`, `<source>/hooks.claude.json`, `<source>/commands/`, and `<source>/prompts/` (see [Adapters](Adapters)).

### `profile`

Optional. The team profile `init` recorded: `frontend`, `backend`, `fullstack`, `devops`, `pure-infra`, `agentic`, `design-engineer` or `custom`. Validated at load (an unknown value fails `sync`). `switch-profile` reads and updates it; sync output does not depend on it, since routing by role happens when packs are selected, not when files are written. See [Profiles](Profiles).

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

A local file overriding an extended/pack file is the intended override mechanism and is silent (listed with `--verbose`). When two *non-local* sources — two `extends` entries, two packs — ship the same file, sync warns and names the winner, because the losing copy (and its `stacks:` range) is otherwise dropped without a trace. Add a local copy to choose explicitly.

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

- `remote` — `owner/repo` of the dedicated marketplace repo. When set, `bluetemberg sync` merges `extraKnownMarketplaces` (keyed by marketplace name) and `enabledPlugins` into `.claude/settings.json`, so Claude Code prompts teammates to install the plugins.
- `plugins` — when omitted, a single plugin named after the project directory is emitted. Each plugin takes `name`, `displayName`, `description`, `profiles` (include only files tagged with one of these profiles; untagged files are included everywhere) and `stacks` (include a stack-specific file only when one of its stacks matches; stack-agnostic files are always included).
- `owner` — `{ "name", "email"?, "url"? }`, written into `marketplace.json`, where Claude Code requires it. When omitted, the owner segment of `remote` is used, else the project directory name.

See [Marketplace](Marketplace) for the full schema, profile filtering behavior, and publishing setup.

### `adapters`

Optional array of **strings** passed to `import()`: npm package names (must be installed in the consumer project), `file:` URLs, or absolute `file://` URLs. Loaded **after** all built-in steps. Specifiers execute code at sync time — use only **trusted** modules; see [Adapters](Adapters) for the module contract and security notes.

### `root`

Optional boolean. When `true`, marks this config as the **inheritance root** in a monorepo: config discovery stops here and never looks at ancestor `bluetemberg.config.json` files above this directory. Defaults to `false`. See [Monorepo config inheritance](#monorepo-config-inheritance).

### `targets`

Maps each content type (rules, agents, skills) to platform-specific output directories and file extensions.

Invalid `targets` shapes (wrong types, unknown platform keys, empty `dir` / missing `ext` for rules and agents) cause **`bluetemberg sync` to fail at config load** with a clear error. A section you omit uses the defaults below for every selected platform. A section you include lists exactly the platforms that get that content type, so leave a platform out of the section to skip it there.

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

Every generated Markdown and TOML file carries a banner immediately after its frontmatter (TOML: as a `#` comment on the first line) naming the source it came from. That covers rules, agents, skills, commands, Copilot prompts, Codex agent TOML, marketplace plugin skills and agents, and the `.github/copilot-instructions.md` copy of `AGENTS.md`. JSON outputs (`mcp.json`, `.cursor/hooks.json`, `.github/hooks/bluetemberg-guardrails.json`, `.gemini/settings.json`, `.agents/mcp_config.json`, the marketplace manifests) cannot carry a comment and have none:

```md
<!-- Generated by bluetemberg from rules/no-console-log.md. Do not edit — run `bluetemberg sync` after editing the source. -->
```

Sources under `llm/` never carry one — it is added on the way out, and re-running sync replaces rather than stacks it. The banner is what makes "this file is disposable" visible to whoever opens the output directly, rather than only to whoever reads the `.gitignore`.

**Upgrading:** the banner changes the bytes of every generated file that carries it, so the first `sync --check` after upgrading reports drift for all of them. Run `bluetemberg sync` once and commit the result. Projects that gitignore their generated output have nothing to commit and nothing to do.

#### Stale generated files (`sync --prune`)

Sync normally **only writes**; it does not delete old outputs when you remove or rename a source file under `llm/`. Run **`bluetemberg sync --prune`** after editing sources to remove generated files that are no longer part of the current plan (under the same managed directories the built-in sync writes to).

**What it deletes:** only files that carry the [generated-file banner](#generated-file-banner). A Markdown or TOML file under a managed directory **without** the banner is treated as hand-written and left alone. JSON outputs (`.cursor/mcp.json`, `.cursor/hooks.json`, `marketplace.json`) cannot carry a banner, so they are left alone too, even when their source under `llm/` is gone. The root `.mcp.json` is not a prune target at all: sync itself removes the servers it manages (see [MCP manifest](#mcp-manifest-llmmcpjson)). One exception: a marketplace plugin directory in which every Markdown file carries the banner is provably generated as a whole, so its `plugin.json` and `hooks.json` are removed with it. Prune lists every file it left in place so you can delete it by hand if it is stale.

**Skill directories are one unit:** a skill's `SKILL.md` carrying the banner is the evidence that the whole directory is generated, since its supporting files (`scripts/`, `references/`, `assets/`) are copied byte for byte and cannot carry one. A supporting file the source no longer has is removed, and the whole directory goes once the skill is gone. A skill directory whose `SKILL.md` has no banner is somebody's skill and is only listed.

**`--check` reports the same files:** a generated file that no source produces any more is listed as `STALE:` and counts as out of sync, so CI catches a removed or renamed source whose output is still being loaded — without deleting anything.

**Caveats:** `--prune` runs only after a write pass with **no recorded errors**. It does not delete files your **adapters** create unless those adapters record outputs via `commitPlannedWrite` and pass through `expectedOutputPaths` from the adapter context (see [Adapters](Adapters)).

**Before you `--prune`:**

- Commit or stash so you can revert if something unexpected is removed.
- If you use **adapters**, ensure they register outputs with `commitPlannedWrite` and the sink’s `expectedOutputPaths` when pruning (see [Adapters](Adapters)).

**Disabled platforms:** Prune only scans outputs for **platforms listed in `platforms`**. Removing a platform from config does **not** delete its old generated files (for example a leftover `.cursor/hooks.json` after you drop `"cursor"`). Delete those paths manually or temporarily re-enable the platform and run a normal write + `--prune` if the files still match the built-in layout.

#### Rules targets

| Platform    | Default dir            | Default ext        |
| ----------- | ---------------------- | ------------------ |
| cursor      | `.cursor/rules`        | `.mdc`             |
| claude      | `.claude/rules`        | `.md`              |
| copilot     | `.github/instructions` | `.instructions.md` |
| devin       | `.devin/rules`         | `.md`              |
| antigravity | `.agents/rules`        | `.md`              |

`gemini` has no rules target: Gemini CLI reads its rules from the `AGENTS.md` managed block. A `targets.rules.gemini` entry that still points at `.gemini/context` (what `init` used to scaffold) is ignored with a warning, since Gemini CLI never read that directory.

#### Agent targets

| Platform | Default dir      | Default ext |
| -------- | ---------------- | ----------- |
| cursor   | `.cursor/agents` | `.md`       |
| claude   | `.claude/agents` | `.md`       |
| copilot  | `.github/agents` | `.agent.md` |

#### Skill targets

| Platform    | Default dir        |
| ----------- | ------------------ |
| cursor      | `.cursor/skills`   |
| claude      | `.claude/skills`   |
| copilot     | `.github/skills`   |
| devin       | `.agents/skills`   |
| codex       | `.agents/skills`   |
| antigravity | `.agents/skills`   |

Devin Desktop, Codex and Antigravity share `.agents/skills`; sync writes each skill there once, and `--prune` removes it once.

Skills are synced as `<skill-name>/SKILL.md` within the target directory. When several platforms share a directory (Devin and Codex both load `.agents/skills/`), it is written and pruned once.

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

When this file exists, sync writes platform-specific MCP config:

| Platform           | Output file                  | Read by                            | How it is written                          |
| ------------------ | ---------------------------- | ---------------------------------- | ------------------------------------------ |
| claude and copilot | `.mcp.json` (project root)   | Claude Code, VS Code, Copilot CLI  | Merged: only bluetemberg's servers change  |
| cursor             | `.cursor/mcp.json`           | Cursor                             | Generated whole                            |
| codex              | `.codex/config.toml`         | Codex                              | `[mcp_servers.*]` managed block            |

All JSON outputs use the `{ "mcpServers": { ... } }` shape. Remote presets use the `http` (Streamable HTTP) transport; the older HTTP+SSE transport is deprecated.

### Root `.mcp.json` is merged, not overwritten

The root `.mcp.json` is also where `claude mcp add --scope project` writes and where teams hand-author servers, so sync never replaces it. It adds, updates and removes **only the servers it manages**, and keeps everything else in the file as it is: other servers, other top-level keys, and their order.

- **Ownership** is recorded in **`llm/mcp-managed.json`**, a generated sidecar listing the server ids sync wrote (`servers`; with Antigravity selected, `antigravity` lists the ones in `.agents/mcp_config.json`). Commit it next to `llm/mcp.json`. JSON can't carry the generated-file banner, and Claude Code drops unknown keys when it rewrites `.mcp.json`, so the record can't live in that file. If the sidecar is unreadable, sync warns and rewrites it; servers removed from the manifest in that same sync may then stay in `.mcp.json`, so delete them by hand.
- **Removing** an entry from `llm/mcp.json` removes only that server from `.mcp.json`. Deleting `llm/mcp.json`, or dropping both `claude` and `copilot` from `platforms`, removes all of them. When nothing else is left in `.mcp.json`, sync deletes the file.
- **Fields you add** to a managed server that the manifest does not set (for example `env` or `headers`) survive re-sync. The fields the manifest sets (`type`, `command`, `args`, `url`) always follow it.
- **A hand-written server whose id the manifest declares** is taken over: its manifest fields are replaced, sync prints a warning, and from then on it is managed.
- **A `.mcp.json` that is not valid JSON** is reported as a sync error and left untouched. So is the whole file when a manifest entry fails to resolve, so a typo never reads as "remove this server". An `llm/mcp.json` that does not parse leaves `.mcp.json` and the Codex block in `.codex/config.toml` untouched too.
- **Key order doesn't count:** an entry that already matches the manifest is left exactly as written. New and changed managed entries are written `type` first.
- **`sync --check`** reports drift in managed servers (and a managed server the manifest no longer declares); edits to your own servers are not drift. A file whose content is already correct is never rewritten, so its formatting stays yours.

**Upgrading from an older version:** sync used to write `.claude/mcp.json` (which Claude Code never reads) and `.github/mcp.json` (Copilot CLI reads the root `.mcp.json` too). It writes neither now. A leftover one whose bytes are exactly what the old version wrote for your current `llm/mcp.json` is reported as `STALE:` by `--check` and removed by `sync --prune`. Anything else in those paths is left in place and listed.

The manifest is vendor-neutral. The `servers` array may contain:

1. **Strings** — preset ids built into Bluetemberg (the same ids offered during `bluetemberg init`, e.g. `interactive`, `context7`, `figma`, `github`). Unknown ids are reported as sync errors; the resolved entries are still written to `.cursor/mcp.json` and Codex, while the root `.mcp.json` is left as it was until the error is fixed.
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

When this file exists and **`cursor`** is in `platforms`, sync writes **`.cursor/hooks.json`** with the same logical content (validated JSON), composed with any [Guardrails](Guardrails)-generated entries. See [Writing Hooks](Writing-Hooks).

## Claude Code hooks (`llm/hooks.claude.json`)

When this file exists and **`claude`** is in `platforms`, sync validates it (whitelisted events, `"type": "command"` hooks only) and merges it into the `hooks` key of **`.claude/settings.json`**, composed with any [Guardrails](Guardrails)-generated entries. **Security boundary:** the file is honored only from the project's own `<source>/` directory — a `hooks.claude.json` shipped by an installed pack or an `extends` source is skipped with a warning, so third-party packs can never inject shell hooks. See [Writing Hooks](Writing-Hooks).

## Claude commands (`llm/commands/`)

Markdown files in this directory (except `README.md`) are copied to **`.claude/commands/`** when **`claude`** is in `platforms`. See [Writing Commands](Writing-Commands).

## Devin Desktop (`devin`)

Windsurf became Devin Desktop on 2026-06-02. Devin reads `AGENTS.md`, workspace rules from `.devin/rules/*.md` (preferred) and `.windsurf/rules/*.md` (legacy fallback), and skills from `.agents/skills/`.

- **Rules** go to `.devin/rules/` with `trigger: always_on` (for `scope: '**'`) or `trigger: glob` plus `globs:`. For a transition period they are also mirrored to `.windsurf/rules/`, so a Devin build that still reads only the legacy path keeps them. **The mirror will be dropped in a later release**, so make sure your team is on a Devin build that reads `.devin/rules/` before then.
- **Skills** go to `.agents/skills/`, shared with Codex and Antigravity. Bluetemberg no longer writes `.windsurf/skills/`.
- **Guardrails** compile to `PreToolUse` hooks in `.devin/hooks.v1.json` for `Bash` checks (Devin's `exec` tool). Hand-written hooks in that file are kept. See [Guardrails](Guardrails#devin-desktop).
- **Workflows** are gone: Devin deprecated them in favor of skills (2026-07-29), so `llm/commands/` no longer emits `.windsurf/workflows/`. Ship the procedure as a skill instead.
- **Upgrading:** generated files left in `.windsurf/workflows/` and `.windsurf/skills/` show up as `STALE:` in `sync --check`. Run `bluetemberg sync --prune` once to remove them. A workflow file without the banner is left alone. A skill directory is handled as one unit, like every [stale skill directory](#stale-generated-files-sync---prune): if its `SKILL.md` carries the banner, the whole directory goes, including any file you added to it. If its `SKILL.md` has no banner, the directory is left alone.

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
| `llm/guardrails/*.md`   | `[[hooks.PreToolUse]]` in `.codex/config.toml` | Fenced managed block for `Bash` guardrails; Codex runs them once trusted with `/hooks`. See [Guardrails](Guardrails#codex). |

`AGENTS.md` and `.codex/config.toml` are edited in place via managed blocks, so they are **not** removed by `--prune` (the generated `.codex/agents/*.toml` files **are** pruned). If `copilot` is also enabled, the rules block is stripped from its derived `copilot-instructions.md`, since Copilot receives scoped rules through `.github/instructions/`. The block is written only when `codex` or `gemini` is selected. For the reasoning, and for the overlap when it is combined with Claude Code, Cursor, Copilot, or Antigravity (all of which read `AGENTS.md` on at least some surfaces), see [Architecture](Architecture#why-the-rules-block-is-only-for-codex-and-gemini-cli).

## Gemini CLI (`gemini`)

For **Gemini CLI for Enterprise** (Gemini Code Assist Standard / Enterprise licences). Gemini CLI loads only the context files named by `context.fileName` in its settings (default `GEMINI.md`) and has no per-path rules, so sync produces:

| Source           | Output                                             | Notes                                                                                     |
| ---------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `AGENTS.md`      | `context.fileName` in `.gemini/settings.json`      | `AGENTS.md` is added to the list; with no list yet it becomes `["AGENTS.md", "GEMINI.md"]`, so a hand-written `GEMINI.md` still loads. |
| `llm/rules/*.md` | managed block in `AGENTS.md`                       | The same block Codex reads, with each rule's `scope` noted as `_Applies to: …_`.          |

Sync owns only that one entry in `.gemini/settings.json`. Every other setting is kept, a file that already lists `AGENTS.md` is left byte for byte, and a file sync cannot parse as JSON (for example one with comments) is never overwritten: sync records an error asking for the one-line edit instead. Agents, skills, and MCP are not emitted for Gemini CLI.

**Upgrading from an earlier bluetemberg:** sync used to copy `AGENTS.md` into a bannered `GEMINI.md` and write rules to `.gemini/context/`, which Gemini CLI never loaded. Both are now reported as `STALE:` by `sync --check`; run `bluetemberg sync --prune` to delete the bannered copies (hand-written files there are kept), and remove any `targets.rules.gemini` entry from your config.

## Antigravity CLI (`antigravity`)

Antigravity CLI succeeds Gemini CLI for individual users. It reads `AGENTS.md` (and `GEMINI.md`) natively, so `AGENTS.md` needs no derivation. When `"antigravity"` is in `platforms`, sync produces:

| Source                  | Output                                     | Notes                                                                                     |
| ----------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `llm/rules/*.md`        | `.agents/rules/<name>.md`                  | `scope: '**'` → `trigger: always_on`; otherwise `trigger: glob`, `globs: scope`. Configurable via `targets.rules.antigravity`. |
| `llm/skills/*/SKILL.md` | `.agents/skills/<name>/SKILL.md`           | Shared with Codex and Devin Desktop. Configurable via `targets.skills.antigravity`.        |
| `llm/mcp.json`          | `mcpServers` in `.agents/mcp_config.json`  | stdio servers as `command` / `args`, remote ones as `serverUrl`.                           |

**Moving from `gemini`:** if your config has explicit `targets.rules` or `targets.skills` sections (`init` writes them), they replace the defaults, so add `"antigravity": { "dir": ".agents/rules", "ext": ".md" }` to `targets.rules` and `"antigravity": { "dir": ".agents/skills" }` to `targets.skills`; otherwise Antigravity gets no rules or skills. The bannered `GEMINI.md` and `.gemini/context/` files from the old Gemini integration are reported as stale with `antigravity` selected too (Antigravity loads `GEMINI.md`), so `bluetemberg sync --prune` removes them.

`.agents/mcp_config.json` is merged exactly like the [root `.mcp.json`](#root-mcpjson-is-merged-not-overwritten): sync adds, updates and removes only the servers it manages, recorded under `"antigravity"` in `llm/mcp-managed.json`, and keeps hand-added servers, other keys, and fields you add to a managed server (for example `env` or `headers`). Removing an entry from `llm/mcp.json`, or dropping `antigravity` from `platforms`, removes that server; when nothing else is left, sync deletes the file. A file sync cannot parse is never overwritten.

## Default behavior

If `bluetemberg.config.json` does not exist, `bluetemberg sync` uses defaults: all three platforms, `llm` as source directory, and standard target paths.
