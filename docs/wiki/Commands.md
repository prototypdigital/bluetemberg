# Commands

## `bluetemberg init [directory]`

Interactive wizard that scaffolds AI tooling into a project. When you need reproducible installs (agents, CI, infrastructure scripts), prefer **non-interactive** mode or **`--config`**.

**Arguments:**

- `directory` — target directory (default: current directory)

**Options:**

| Option | Notes |
| ------ | ----- |
| `--non-interactive` | Use the same preset logic as the wizard for the chosen `--profile` (default profile: `fullstack`), then merge optional overrides. Exclusive with `--config`. |
| `--config <file>` | Validate JSON against `InitAnswers` (`teamProfile`, `projectName`, `platforms`, `ruleSource`, `rules`, `ruleCollections`, boolean includes, arrays, …). Overrides like `--profile`, `--omit-mcp`, and CSV lists cannot be mixed with `--config`. |
| `--profile <id>` | With `--non-interactive` only (`frontend`, `backend`, `fullstack`, `devops`, `pure-infra`, `agentic`, `design-engineer`, `custom`). |
| `--project-name`, `--project-description` | With `--non-interactive` without `--config`. |
| `--package-manager` | Values: `pnpm`, `npm`, or `yarn`. `--non-interactive` only. |
| `--platforms <csv>` | e.g. `cursor,claude` (non-empty when set). Ids: `cursor`, `claude`, `copilot`, `gemini`, `antigravity`, `devin`, `codex`, `claude-marketplace`; `windsurf` is accepted as an alias for `devin` (Devin Desktop, formerly Windsurf) and written to config as `devin`. `--non-interactive` only. |
| `--rule-source` | Values: `collections` (default) or `none` (empty scaffold — bring your own rules). `--non-interactive` only. |
| `--rule-collections <csv>` | Registry collection ids to include (e.g. `typescript,git`). Applies when `--rule-source collections`. |
| `--agents <csv>`, `--skills <csv>`, `--mcp-servers <csv>` | Scoped lists when scaffolding is enabled. |
| `--sources <csv>` | External source specs (e.g. `github:owner/repo#HEAD:rules`, `prpm:name`, `cursor-directory:slug`), written to `llm/rule-sources.json`. `--non-interactive` without `--config`. |
| `--stacks <csv>` | Technology stacks to manage, written to config `stacks` (e.g. `payload@3.4.1,nextjs@auto`; a bare name → `auto`). `--non-interactive` without `--config`. |
| `--omit-agents`, `--omit-skills`, `--omit-mcp`, `--omit-github` | Shortcut booleans (`--non-interactive` only). `--omit-github` skips the GitHub/community files listed below. |
| `--force` | Overwrite `AGENTS.md`, `CLAUDE.md`, and the GitHub/community files when they already exist. Without it, init keeps those files and lists what it kept. Works in every mode. |
| `--silent` | Hide progress/success logs and forward silence to initial `sync` (still exit non-zero on failure). **Requires** `--non-interactive` **or** `--config`. |

**Global discovery:** combine `--help --json` (any position with `--help`/`-h`) to dump team profiles, package managers, rules, collections, agents, skills, MCP presets, and CLI metadata as JSON (`writeSync`-safe for piping).

From the repo root, `npm run build` must have produced `dist/` first — otherwise `bin/cli.js` cannot load catalogs or `--help --json`.

**What it does:**

- **Interactive (default)** — Steps 1–3 are prompts:
  1. Pick a **team profile** (sets smart defaults for everything below).
  2. Enter project name, description, and package manager.
  3. Pick platforms; **confirm detected stacks** (auto-detected from the project and pre-checked — drive which rules, agents and skills apply by version, written to config `stacks`; add undetected ones free-text, or skip the step entirely when nothing is detected); rules/agents/skills/MCP, and (optionally) external rule sources.
- **`--non-interactive`** — Skips prompts 1–3; defaults come from **`--profile`** (default `fullstack`) plus any override flags you pass.
- **`--config <file>`** — Skips prompts 1–3; answers come entirely from validated JSON (`InitAnswers`).

Then, for **every** run:

4. Creates `llm/` with the resolved starter content. Packs in `llm/packages.json` get a `^<latest published version>` range looked up from the registry (`latest` if it can't be reached; see [Registry](Registry#manifest-and-lockfile))
5. Generates `bluetemberg.config.json`
6. Creates `AGENTS.md`, `CLAUDE.md` (if Claude is among selected platforms; it imports `@AGENTS.md` so Claude Code loads both, see [Architecture](Architecture#claude-code-and-agentsmd)), and, if Gemini CLI is selected, `.gemini/settings.json` pointing it at `AGENTS.md` (via the initial sync)
7. Writes `llm/mcp.json` with chosen MCP preset ids when MCP is included; the initial sync merges those servers into the root `.mcp.json` (for Claude Code / Copilot, keeping any servers already there), writes `.cursor/mcp.json`, and/or merges them into `.agents/mcp_config.json` for Antigravity (per selected platforms)
8. Adds `sync:llm-config` scripts to `package.json`
9. Patches `.prettierignore` with `llm/` and `docs/wiki/` to protect prose from formatters
10. Writes the GitHub/community files the wizard selected (Dependabot, issue and PR templates, CODEOWNERS, CONTRIBUTING, LICENSE, CODE_OF_CONDUCT, SECURITY). Headless runs write all of them unless `--omit-github` is passed. Never CI/CD workflows.

**Existing files are never overwritten.** `AGENTS.md`, `CLAUDE.md`, and the GitHub/community files are yours once they exist: re-running `init` keeps them and prints a "Kept N existing file(s)" list. Pass `--force` to replace them with the templates. The files bluetemberg owns (`bluetemberg.config.json`, `llm/packages.json`, `llm/mcp.json`, `llm/rule-sources.json`) are refreshed on every run.
10. Runs an initial sync to generate all platform-specific files

The wizard offers every rules, agents and skills pack in the catalog. Packs are pre-selected based on the chosen profile; a pack that targets a stack (Payload, Next.js, Tailwind, …) is pre-selected only when that stack is detected, kept in the stack prompt, or passed with `--stacks`. See [Profiles](Profiles) for what each team profile defaults to.

**Example:**

```bash
npx bluetemberg init
npx bluetemberg init ./my-project

# Headless
npx bluetemberg init --non-interactive --profile devops --omit-mcp
npx bluetemberg init --non-interactive --profile pure-infra --omit-mcp --silent
npx bluetemberg init --non-interactive --profile fullstack --stacks "payload@3.4.1,nextjs@auto"
npx bluetemberg init --config ./bluetemberg.init.json ./my-project
```

Programmatic callers can keep using `init(root, opts)`/`scaffold(...)`/`sync(...)` exported from the package (`InitRunOptions` describes the programmatic mirror of the CLI knobs).

## `bluetemberg switch-profile <profile> [directory]`

Changes the team profile recorded in `bluetemberg.config.json` without re-running the wizard. Non-destructive:

- Adds the new profile's default agent and skill packs to `llm/packages.json` when missing, with a `^<latest>` range looked up from the registry (`latest` if it can't be reached).
- Never removes a pack and never touches `llm/` content.
- Lists official agent/skill packs that are not among the new profile's defaults, so you can remove them by hand. Rule collections and third-party packs are never flagged.
- Updates `profile` in the config.

Then run `bluetemberg install` and `bluetemberg sync`. See [Profiles](Profiles#switching-profiles).

| Option | Notes |
| ------ | ----- |
| `--silent` | Suppress output (exit code still reports failure) |

## `bluetemberg uninstall [directory]`

Removes bluetemberg from a project: every generated file, `bluetemberg.config.json`, `.bluetemberg/`, and the state files under `llm/` (`packages.json`, `packages-lock.json`, `mcp.json`, `mcp-managed.json`, `rule-sources.json`, `rule-sources-lock.json`). In shared files it removes only bluetemberg's own entries: managed servers in `.mcp.json` and `.agents/mcp_config.json`, the synced `hooks` key and the marketplace's `extraKnownMarketplaces` / `enabledPlugins` entries in `.claude/settings.json`, `AGENTS.md` in `.gemini/settings.json` `context.fileName`, the managed blocks in `AGENTS.md` and `.codex/config.toml`, and the `.bluetemberg/` entry in `.gitignore`.

Kept: your own sources under `llm/`, the `AGENTS.md`, `CLAUDE.md` and GitHub files `init` scaffolded, and anything else you wrote. Run `npm uninstall bluetemberg` afterwards.

| Flag | Description |
| ---- | ----------- |
| `--dry-run` | Run the procedure on a temporary copy and list what would be removed or edited; the project is untouched |
| `-y`, `--yes` | Skip the confirmation prompt (required without a TTY) |
| `--silent` | Suppress output |

Without `--yes`, the command prints the dry-run plan and asks before changing anything. Uninstall runs on the given directory only, not on nested monorepo packages.

## `bluetemberg preview [profile]`

Prints the rule collections, guardrails, agents and skills a profile preselects, with each pack's current version and a one-line preview, without touching the project. Use it to compare profiles before `init` or `switch-profile`. Stack-specific packs are filtered by the stacks detected in the current directory, as `init` would; the ones it skips are listed at the end.

| Option | Notes |
| ------ | ----- |
| `--list` | List the available profile ids with their descriptions |
| `--force` | Re-fetch the pack catalog instead of using the 24-hour cache |
| `--silent` | Suppress output |

The listing comes from the live catalog (cached in `.bluetemberg/catalog.json`, the only file this command writes; the committed snapshot is the offline fallback). The wizard reads the committed snapshot, so until that snapshot is refreshed the two can differ slightly.

## `bluetemberg sync [directory]`

Reads vendor-neutral sources from `llm/` and generates platform-specific files.

**Arguments:**

- `directory` — project root directory (default: current directory)

**Options:**

| Option | Description |
| ------ | ----------- |
| `--check` | Dry-run mode; exits with code 1 if any generated files are out of sync |
| `--dry-run` | Alias for `--check` |
| `--diff` | Under `--check`, print a per-file unified diff (summary counts + `@@` hunks) of what drifted, so CI shows *what* changed, not just *how many* files. Implies `--check`; honors `--silent`; never changes counts or exit code |
| `--silent` | Suppress progress output (useful in scripts and CI); errors still print to stderr |
| `--prune` | After a successful write pass, delete stale generated files under managed output dirs — only files that carry the generated-file banner; hand-written files and JSON outputs are kept and listed (ignored with `--check`; see [Configuration](Configuration)) |
| `--verbose` | Emit debug output: resolved source directories (including `extends` entries), per-file origin when multiple sources are active, and any non-fatal warnings |
| `--no-recursive` | Sync only the invocation directory; do not descend into configured workspace packages (see **Monorepos** below) |

Before first use of `--prune`, read the short pre-flight list and platform notes under **Stale generated files** in [Configuration](Configuration).

**Stale files are drift.** `--check` also looks for generated files (banner present) under the managed output dirs that no source produces any more — a rule you deleted or renamed, or one a stack change filtered out — and reports each as `STALE:`. They count as out of sync and exit 1, and the summary points at `sync --prune`. With `devin` enabled this includes generated files left in `.windsurf/workflows/` and `.windsurf/skills/` from before the Devin Desktop rename; prune them once after upgrading (see [Configuration](Configuration#devin-desktop-devin)). Hand-written files and JSON outputs are never reported, because without a banner bluetemberg can't tell them from its own.

**Monorepos (recursive by default):** sync discovers every `bluetemberg.config.json` at or below the directory you run it in — the config tree is the workspace map — and syncs each configured package against **its own** detected stacks. So one `bluetemberg sync` (or `sync --check` in CI) keeps a whole monorepo in sync: `packages/web` gated on its React, `packages/legacy` on its own, with no flag to forget and no false-green check. A repo with no sub-package configs is unaffected (single-package path). Pass `--no-recursive` to sync only the current directory. Discovery skips `node_modules`, dot-folders, and build dirs. See [Stacks & Versioning](Stacks) and [Monorepo config inheritance](Configuration#monorepo-config-inheritance).

**Version-aware stack filtering:** sync detects the project's technology stacks and versions, then **hard-excludes** any rule, guardrail, agent, or skill whose `stacks:` constraint is not satisfied — a `payload: ">=3 <4"` rule never reaches a Payload-2 project. Excluded files are listed under a `filtered out by version` line so you can audit them. Low-confidence detection (a version coerced from a `package.json` range) warns but still applies — never silently dropped. Content with no `stacks:` is stack-agnostic and always applies, so a project that declares no stacks syncs exactly as before. See [Configuration](Configuration) (the `stacks` field) and [Writing Rules](Writing-Rules).

**Example:**

```bash
npx bluetemberg sync
npx bluetemberg sync --check
npx bluetemberg sync --check --diff
npx bluetemberg sync --dry-run --silent
npx bluetemberg sync --prune
npx bluetemberg sync ./my-project
```

## `bluetemberg detect [directory]`

Report the technology stacks and versions detected in the project, each with its detection confidence and coverage status. Detection precedence (highest confidence first): a pinned version in the `stacks` config field → `node_modules/<pkg>/package.json` → `package-lock.json` → a version coerced from the `package.json` range (low confidence). This is the read side of the same machinery that gates rules at sync — an agent can call it once and self-select version-correct guidance.

| Option | Description |
| ------ | ----------- |
| `--json` | Emit machine-readable JSON: `detected[]` (each with `coverage.precision` and a `coverage.reason` when uncovered), `gaps[]` (stacks whose detected version has no covering guidance), `weakCoverage[]` (stacks covered only name-level), `warnings[]` |
| `--silent` | Suppress progress output; errors still print to stderr |

```bash
npx bluetemberg detect
npx bluetemberg detect --json
```

Each `warnings[]` entry carries a `level`: `low-confidence` names the stack whose version was coerced, while `coverage-source` (with `stack: null`) means a source of covered ranges could not be read — a malformed `llm/packages.json`, say — so coverage may under-report. A broken manifest degrades the report to catalog-only coverage; it never aborts it.

## `bluetemberg coverage <stack>[@version] [directory]`

Answer "do we have version-correct guidance for this stack?" against the guidance available here and the detected stacks. Reports whether the stack is `known`, whether it is `covered`, the most-specific covered range, and — when it is not covered — a `reason`.

Covered ranges are read from the `stacks:` frontmatter of the guidance actually available to the project (its own source dir, `extends` entries, installed packs, external sources), resolved exactly as the sync gate resolves it. So a pack shipping `react: ">=18 <19"` covers React 18 and reports React 19 as a `version-uncovered` gap. A `*` range is **name-level** — a catalogued pack targets the stack but nothing declares a version range for it, so coverage is only "some guidance exists". Name-level is the fallback, not the default: a stack with any declared range never falls back to `*`.

| Option | Description |
| ------ | ----------- |
| `--json` | Emit machine-readable JSON (`query`, `result` — including `precision` — and `warnings[]` for coverage sources that could not be read) |
| `--silent` | Suppress progress output; errors still print to stderr |

```bash
npx bluetemberg coverage payload@3.4.0
npx bluetemberg coverage nextjs --json
```

## `bluetemberg why <file> [directory]`

Explain why one rule, agent, skill or guardrail is **included** in or **excluded** from this project. It answers from the same source resolution and version gate sync uses, so it cannot disagree with what sync wrote.

`<file>` can take any of three forms. The report says which one matched (tried in this order):

| Form | Example | Notes |
| ---- | ------- | ----- |
| Source path | `llm/rules/payload-v3.md`, `llm/skills/migrate/`, `.bluetemberg/packs/<pack>/<ver>/llm/rules/x.md` | Relative (to the project directory, or failing that the current directory), `./`-prefixed or absolute. Naming a copy that a higher-priority source shadows explains the copy sync actually uses, with a note. |
| Generated path | `.claude/rules/payload-v3.md`, `.cursor/rules/x.mdc`, `.claude/skills/migrate` | Resolved against the configured targets, so it works for an excluded item too (the path sync *would* write) and names the platform. |
| Id | `payload-v3`, `rules/payload-v3` | A bare id matches every kind that ships it; prefix the kind to pick one. |

For each match it reports:

- **source**: the winning copy (`local`, `extends <entry>`, `<pack>@<version>`, or `<source>@<ref>` for an external source) plus any shadowed lower-priority copies.
- **constraint**: whether it came from the file's own `stacks:` frontmatter (version-precise), the owning pack's catalog tag (name-only, `*`), or nothing (stack-agnostic).
- **each `stack: range`** checked against the detected version, with its confidence and where it came from. A coerced (low-confidence) detection is flagged.
- **why it's out**: a version mismatch, an absent stack, or (for a guardrail) frontmatter or regex sync rejects. It also lists invalid ranges and, when the item is included, the generated outputs.

```bash
npx bluetemberg why payload-v3
npx bluetemberg why .claude/rules/payload-v3.md --json
```

```
"payload-v3" matched as id.

rules/payload-v3: EXCLUDED — payload >=3 <4 (you're on 2.5.0)
  source:     local (llm/rules/payload-v3.md)
  constraint: frontmatter `stacks:` (version-precise)
    ✘ payload ">=3 <4" vs 2.5.0 (declared, from config)
```

Exits 1 when nothing matches `<file>`. In a monorepo, a path inside a package (`packages/web/llm/rules/payload-v3.md`, `packages/web/.claude/rules/payload-v3.md`) is answered by that package's own config and detected stacks, the decision `sync` made there, and the report names the package. An id typed at the workspace root answers for the root config only and warns; pass the package directory instead (`npx bluetemberg why payload-v3 packages/web`).

### Upgrade diff: `bluetemberg why --diff <stack@version> [directory]`

List the items that would be **added** or **removed** if a stack were at the given version, without writing anything. It re-runs the gate with that version substituted for the detected one. Repeat `--diff` to move several stacks at once. A partial version is completed the way the gate compares it (`payload@4` → `4.0.0`), and a stack that isn't detected today is treated as newly present. A stack that is neither detected nor named by any constraint can't change the set, so it gets a warning (likely a typo, e.g. `Payload@4`) instead of a silent "no change". At a monorepo root, pass the package directory.

```bash
npx bluetemberg why --diff payload@4
npx bluetemberg why --diff payload@4 --diff nextjs@15 --json
```

```
If payload 3.4.1 → 4.0.0 (nothing is written):
  + rules/payload-v4 [local] — was: payload >=4 (you're on 3.4.1)
  - rules/payload-v3 [local] — payload >=3 <4 (you're on 4.0.0)
  unchanged: 14 included, 0 excluded
```

| Option | Description |
| ------ | ----------- |
| `--diff <stack@version>` | Diff the resolved set at this hypothetical version (repeatable). Takes no `<file>` |
| `--json` | Emit the report as JSON (`matchedAs`, `matches[]`, … or `overrides[]`, `added[]`, `removed[]`, `unchanged`) |

## `bluetemberg scan-org [paths...]`

**Maintainer tooling** — read-only. Scan N repositories and build a `(stack, version)` usage histogram against the installed catalog, then rank the uncovered buckets by usage so you author the highest-impact rules first. It reuses the exact detection that gates rules at sync. It **never writes** anything.

Two sources, one report — and they can be combined in a single run:

- **Local** — pass filesystem paths to cloned repos. Detection precedence is `node_modules` → `package-lock.json` → coerced `package.json` range, so installed `node_modules` give `exact` versions, a lockfile alone still gives `exact`, and a bare manifest falls back to `coerced`.
- **Remote** — `--org`/`--repos` read each repo's `package.json` (and `package-lock.json` when present) over the GitHub Contents API **without cloning**. Detection precedence is `package-lock.json` → coerced `package.json` range (there is no `node_modules` over the API).

The corpus it compares against is read from the current working directory — its catalog (project cache → committed snapshot) plus the version ranges its available guidance declares — never from the scanned repos, whose own rules would otherwise count as org-wide coverage and mask the gaps you are looking for.

| Option | Description |
| ------ | ----------- |
| `--org <name>` | **[remote]** Scan every non-fork, non-archived repo in this GitHub org |
| `--repos <list>` | **[remote]** Comma-separated `owner/repo` to scan |
| `--since <days>` | **[remote `--org`]** Only include repos pushed to within the last N days |
| `--json` | Emit machine-readable JSON (`roots`, `scanned`, `empty`, `skipped`, `histogram`, `gaps`) |
| `--silent` | Suppress progress output; errors still print to stderr |

```bash
npx bluetemberg scan-org ../app-a ../app-b ../app-c       # local clones
npx bluetemberg scan-org --org acme --json                # every repo in an org
npx bluetemberg scan-org --org acme --since 90            # only repos active in the last 90 days
npx bluetemberg scan-org --repos acme/app,acme/web        # specific repos
npx bluetemberg scan-org ../app-a --repos acme/web        # local + remote, merged
```

### Remote authentication

A remote scan requires a GitHub token, read from the **environment only** (`GITHUB_TOKEN`, then `GH_TOKEN`) — never from a project file, and never logged. If you use the [`gh` CLI](https://cli.github.com/), `GH_TOKEN` is typically already set. With no token, `--org`/`--repos` exits with a clear error.

Progress is written to **stderr**, so `--json` output on stdout stays clean for piping.

### Behaviour notes

- The `gaps` array is the authoring priority list: each entry is an uncovered `(stack, version)` with its usage `count` and a `reason` — `version-uncovered` when guidance for the stack exists but no covered range satisfies that version (e.g. you ship `react: ">=18 <19"` and 12 repos moved to 19), `no-coverage` when nothing targets the stack at all.
- The `weakCoverage` array is the **second** priority list, ranked the same way: buckets that are covered, but only by a name-level wildcard. One stack-agnostic file in a pack the catalog tags `["react"]` covers every React version, so without this tier a version era with no guidance of its own would disappear into "covered". These repos do get guidance — just not version-correct guidance.
- Coverage compares against the catalog **and** the version ranges declared by the guidance available in the working directory, so `scan-org` answers the version-era question, not just "does a pack for this stack exist". Install the packs you publish into the directory you scan from to get version-precise buckets; an uninstalled catalogued pack can only contribute name-level (`*`) coverage.
- If that corpus cannot be read (a malformed manifest, say), the scan degrades to catalog-only coverage and records why in `warnings` — every gap it then reports may be a false positive.
- Remote repos that can't be read (no `package.json`, private/forbidden, rate-limited, …) are recorded in `skipped` with a typed `reason` and the scan continues — one bad repo never aborts the run.
- Remote detection only reads `package-lock.json`; repos using `yarn.lock`/`pnpm-lock.yaml` resolve to `coerced` confidence from the manifest range (still useful for a histogram). Scan a local clone for `exact` versions across any package manager.

## `bluetemberg stacks lint [directory]`

**Maintainer tooling** — read-only. Lint the lifecycle of the `stacks:` ranges guidance declares. Two findings, both meaning a rule silently applies to versions nobody has checked it against:

- **`open-ended`** — the range has no upper bound (`>=2`, `>13.4`, `^2 || >=4`). It will match every future major the day it ships.
- **`past-latest-major`** — the range is bounded, but reaches past the stack's latest release (`>=3 <6` while Payload is on 3.x). For a `0.x` stack the release line is the minor (`>=0.81 <0.90` while React Native is on 0.82).

The directory is either a **consuming project** — the lint reads exactly the guidance `coverage` reads (the project's source dir, `extends`, installed packs, external sources) — or a **packs repo**, recognised by a root `catalog.json` plus `packages/<pack>/llm/`. In a packs repo every pack is read on its own (ids are prefixed with the pack) and only authored frontmatter ranges are linted. `*` is never flagged: an explicit "any version" is a deliberate name-level claim.

**Where "latest" comes from:** the npm registry's `dist-tags` for the stack's package (`nextjs` → `next`, mapped by the same [stack table](Configuration#stacks) detection uses; other names are their own package). It is always the public registry (`registry.npmjs.org`) — stack packages are public frameworks — and answers are cached for 24 hours in `$XDG_CACHE_HOME/bluetemberg/latest-versions.json` (default `~/.cache/bluetemberg/`). With `--offline`, or when the registry cannot be reached, a cached answer of any age is used; with none, the stack is reported as **unchecked** (`NOTE: could not check latest major for payload (offline)`), and only its open-ended ranges are flagged.

| Option | Description |
| ------ | ----------- |
| `--offline` | Never query the registry; use cached latest versions only |
| `--json` | Emit machine-readable JSON: `mode` (`project` \| `packs-repo`), `checked`, `findings[]` (`kind`, `stack`, `range`, `from`, `origin`, `latest`, `message`), `latest[]` (per stack: `package`, `latest`, `source` — `registry` \| `cache` \| `stale-cache` — `checkedAt`, `note`), `unchecked[]`, `warnings[]` |
| `--silent` | Suppress output; the exit code still reports the result |

Exits **1** when there are findings, so it can gate CI. Unchecked stacks alone do not fail it, so a `past-latest-major` finding can appear online and not offline. In a consuming project the findings include installed packs' ranges, marked `(catalog)`, which only the pack can fix; your own are marked `(local)`. A CI gate on pack content belongs in the packs repo.

```bash
npx bluetemberg stacks lint                          # this project's available guidance
npx bluetemberg stacks lint ../bluetemberg-packs     # every pack, where rules are authored
npx bluetemberg stacks lint --offline --json
```

## `bluetemberg stacks list <stack>[@version|@range] [directory]`

**Maintainer tooling** — read-only. List the guidance that declares a range for a stack — "every rule pinned to Payload 3". With a version or range, only declarations that admit it are listed: a declaration matches when some version satisfies both. A partial version is its whole line (`payload@3` = any 3.x), an exact one is a point matched the way sync matches a detected version (`payload@3.4.1`; a prerelease such as `3.4.1-canary.2` counts as 3.4.1), and a range is a window (`"payload@>=3 <5"`). Without one, every ranged declaration for the stack is listed.

Name-level declarations (`*`, or a pack-tagged file with no range of its own) apply to any version, so they are listed apart under `nameLevel`, never mixed into the pinned matches. The directory works as for [`stacks lint`](#bluetemberg-stacks-lint-directory): a consuming project or a packs repo. An invalid version or range is an error, not an empty list.

| Option | Description |
| ------ | ----------- |
| `--json` | Emit machine-readable JSON: `mode`, `query`, `matches[]` (`stack`, `range`, `from`, `origin`), `nameLevel[]`, `warnings[]` |
| `--silent` | Suppress output |

```bash
npx bluetemberg stacks list payload@3
npx bluetemberg stacks list "payload@>=3 <5" ../bluetemberg-packs --json
npx bluetemberg stacks list nextjs
```

## `bluetemberg mcp serve [directory]`

Run Bluetemberg itself as an [MCP](https://modelcontextprotocol.io) server over **stdio**, exposing the stack model as tools so an agent gets structured coverage without shelling out. It is the same machinery behind the `--json` flags — one implementation, two surfaces — and is **read-only** (it never writes files).

Tools:

| Tool | Args | Returns |
| ---- | ---- | ------- |
| `bluetemberg_detect_stacks` | — | Detected stacks, versions, confidence, coverage, gaps, warnings |
| `bluetemberg_query_coverage` | `stack`, optional `version` | Whether version-correct guidance exists for the stack, with the gap `reason` when it does not |
| `bluetemberg_list_stacks` | — | The live stack registry (catalog ∪ detected) with covered ranges |
| `bluetemberg_why` | `file` (source path, generated path or id), or `diff` (array of `stack@version`) | The [`why`](#bluetemberg-why-file-directory) report for one item, or the upgrade diff |
| `bluetemberg_org_histogram` | `roots` (array of repo paths), `org`, `repos`, `since` — all optional; combine local roots with a remote org scan | **[maintainer]** `(stack, version)` usage histogram across the given repos vs catalog coverage, with a usage-ranked gap list |

Register it with an MCP client (example for Claude Code's `.mcp.json`):

```json
{
  "mcpServers": {
    "bluetemberg": { "command": "npx", "args": ["bluetemberg", "mcp", "serve"] }
  }
}
```

> stdout is the MCP protocol channel — do not pipe other output through it. Diagnostics go to stderr.

## `bluetemberg add <packages...>`

Install one or more rule packs from the npm registry. See [Registry](Registry) for full details.

```bash
bluetemberg add @company/rules-frontend
bluetemberg add @company/rules-frontend@^1.2.0

# Add several packs at once
bluetemberg add bluetemberg-rules-typescript bluetemberg-agents-code-reviewer
```

| Option | Description |
| ------ | ----------- |
| `--skip-signature-verification` | Allow unsigned packs from a non-default registry. Ignored for `registry.npmjs.org` |
| `--allow-external-tarball-host` | Allow a tarball served from a host other than the configured registry |
| `--silent` | Suppress progress output; errors still print to stderr |

## `bluetemberg remove <package>`

Remove a rule pack from the project.

```bash
bluetemberg remove @company/rules-frontend
```

## `bluetemberg list`

List installed rule packs with their resolved versions.

```bash
bluetemberg list
```

## `bluetemberg install`

Install all packs from the manifest (`llm/packages.json`). Run after cloning a repo.

```bash
bluetemberg install
bluetemberg install --force

# Against a token-gated, unsigned self-hosted registry (token scoped in .npmrc)
NPM_TOKEN=... bluetemberg install --skip-signature-verification
```

| Option | Description |
| ------ | ----------- |
| `--force` | Force re-download even if cached |
| `--dry-run` | Resolve packs and print the install plan without writing files |
| `--skip-signature-verification` | Allow unsigned packs from a non-default registry. Ignored for `registry.npmjs.org` |
| `--allow-external-tarball-host` | Allow a tarball served from a host other than the configured registry |
| `--silent` | Suppress progress output; errors still print to stderr |

Credentials for a private registry come from `.npmrc` or `NPM_TOKEN`/`NODE_AUTH_TOKEN` — see
[Private registries](Registry#private-registries).

## `bluetemberg update [package]`

Re-resolve and upgrade rule packs to the best version satisfying their manifest range. See [Registry](Registry) for full details.

```bash
bluetemberg update
bluetemberg update @company/rules-frontend
bluetemberg update --latest
```

| Option | Description |
| ------ | ----------- |
| `--latest` | Widen ranges to `"latest"` in manifest, not just re-resolve current range |
| `--skip-signature-verification` | Allow unsigned packs from a non-default registry. Ignored for `registry.npmjs.org` |
| `--allow-external-tarball-host` | Allow a tarball served from a host other than the configured registry |
| `--silent` | Suppress progress output; errors still print to stderr |

## `bluetemberg verify [directory]`

Re-checks every pack in `.bluetemberg/packs/` against the registry: the tarball's SHA-512 integrity and its ECDSA registry signature, using the key id the lockfile recorded. Exits 1 on the first failure. Run it in CI after `install` when you want the supply-chain checks on record. See [Registry](Registry).

| Option | Notes |
| ------ | ----- |
| `--skip-signature-verification` | Skip the ECDSA check, for self-hosted registries that do not sign. Never needed for `registry.npmjs.org` |
| `--silent` | Suppress output |

## `bluetemberg search <query>`

Search for rule packs tagged with `bluetemberg-pack`, in the registry the project's manifest
configures — so a [private registry](Registry#private-registries) is searchable too, using the
same credentials as `install`.

```bash
bluetemberg search typescript
bluetemberg search "frontend rules" --limit 10
```

## `bluetemberg source <subcommand>`

Manage **external rule sources** — rules pulled from outside the npm pack registry and translated into native bluetemberg format. See [Sources](Sources) for the full guide. Supported backends: **GitHub repos**, **PRPM**, and **cursor.directory** (works out of the box; experimental — see [Sources](Sources)).

| Subcommand | Description |
| ---------- | ----------- |
| `source add <spec>` | Resolve, fetch, translate, and pin a source. Spec: `github:owner/repo[#ref][:path]`, `prpm:name[@range]`, or `cursor-directory:slug`. |
| `source remove <key>` | Remove a source (key as shown by `source list`). |
| `source list` | List configured sources with their pinned refs. |
| `source install [--force]` | Restore all sources from `llm/rule-sources-lock.json` (like `npm ci`). Run after cloning. |
| `source update [key]` | Re-resolve the floating spec to the newest ref/version and reinstall if it changed. |
| `source search <query>` | Search backends that support discovery (`--type`, `--limit`). GitHub repos are not searchable. |

```bash
# Pull the rules/ folder of awesome-cursorrules at its current default branch
bluetemberg source add "github:PatrickJS/awesome-cursorrules#HEAD:rules"
# Pull a single package from PRPM (a rule, agent, or skill)
bluetemberg source search react --type prpm
bluetemberg source add "prpm:@patrickjs/nextjs-react-tailwind-cursorrules-prompt-file"
bluetemberg source list
bluetemberg sync            # external rules now emit to every configured platform
bluetemberg source install  # on a fresh clone, restore from the lockfile
```

Each `add`/`update`/`install` writes `.bluetemberg/sources/` (git-ignored cache) plus the committed `llm/rule-sources.json` (manifest) and `llm/rule-sources-lock.json` (lockfile). Sources are the **lowest** priority during sync — local `llm/`, `extends`, and npm packs all win on a filename clash.

## Exit codes

| Code | When |
| ---- | ---- |
| 0 | Sync finished with no recorded errors, and (if `--check`) all generated files match the expected content |
| 1 | Any sync error was recorded (invalid optional manifests, unknown MCP preset ids, adapter load failures, per-file rule errors, malformed managed-block markers in `AGENTS.md` / `.codex/config.toml`, a `.gemini/settings.json` or `.agents/mcp_config.json` that isn't valid JSON, etc.), **or** `--check` found one or more files out of sync, including stale generated files (`STALE:`) |

**Warnings vs errors:** Some issues are non-fatal and appear as warnings — for example, an `extends` entry that references a path or package that does not exist, or (with `claude` selected) a root `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` that has no `@AGENTS.md` import and so hides `AGENTS.md` from Claude Code ([details](Architecture#claude-code-and-agentsmd)). Warnings are logged and included in the programmatic `SyncResults.warnings` array but do **not** cause exit code 1. Use `--verbose` to see all warnings even when there are no errors.

Use `--silent` in CI only together with checking `$?` (or equivalent): failures are signaled by the exit code, not only by log lines.

**When to run:**

- After creating or editing any file in `llm/rules/`, `llm/agents/`, `llm/skills/`, `llm/mcp.json`, `llm/hooks.json`, `llm/commands/`, or `llm/prompts/`
- After changing `platforms`, `extends`, or `adapters` in `bluetemberg.config.json`
- In CI to verify generated files haven't drifted (use `--check`)

## Package scripts

After running `init`, these scripts are added to your `package.json`:

| Script                  | Command                        |
| ----------------------- | ------------------------------ |
| `sync:llm-config`       | `npx bluetemberg sync`         |
| `sync:llm-config:check` | `npx bluetemberg sync --check` |
