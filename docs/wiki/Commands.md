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
| `--profile <id>` | With `--non-interactive` only (`frontend`, `backend`, `fullstack`, `devops`, `pure-infra`, `custom`). |
| `--project-name`, `--project-description` | With `--non-interactive` without `--config`. |
| `--package-manager` | Values: `pnpm`, `npm`, or `yarn`. `--non-interactive` only. |
| `--platforms <csv>` | e.g. `cursor,claude` (non-empty when set). `--non-interactive` only. |
| `--rule-source` | Values: `collections` (default) or `none` (empty scaffold — bring your own rules). `--non-interactive` only. |
| `--rule-collections <csv>` | Registry collection ids to include (e.g. `typescript,git`). Applies when `--rule-source collections`. |
| `--agents <csv>`, `--skills <csv>`, `--mcp-servers <csv>` | Scoped lists when scaffolding is enabled. |
| `--sources <csv>` | External source specs (e.g. `github:owner/repo#HEAD:rules`, `prpm:name`, `cursor-directory:slug`), written to `llm/rule-sources.json`. `--non-interactive` without `--config`. |
| `--omit-agents`, `--omit-skills`, `--omit-mcp` | Shortcut booleans (`--non-interactive` only). |
| `--silent` | Hide progress/success logs and forward silence to initial `sync` (still exit non-zero on failure). **Requires** `--non-interactive` **or** `--config`. |

**Global discovery:** combine `--help --json` (any position with `--help`/`-h`) to dump team profiles, package managers, rules, collections, agents, skills, MCP presets, and CLI metadata as JSON (`writeSync`-safe for piping).

From the repo root, `npm run build` must have produced `dist/` first — otherwise `bin/cli.js` cannot load catalogs or `--help --json`.

**What it does:**

- **Interactive (default)** — Steps 1–3 are prompts:
  1. Pick a **team profile** (sets smart defaults for everything below).
  2. Enter project name, description, and package manager.
  3. Pick platforms, rules/agents/skills/MCP, and (optionally) external rule sources (per your choices).
- **`--non-interactive`** — Skips prompts 1–3; defaults come from **`--profile`** (default `fullstack`) plus any override flags you pass.
- **`--config <file>`** — Skips prompts 1–3; answers come entirely from validated JSON (`InitAnswers`).

Then, for **every** run:

4. Creates `llm/` with the resolved starter content
5. Generates `bluetemberg.config.json`
6. Creates `AGENTS.md`, `CLAUDE.md` (if Claude is among selected platforms), and `GEMINI.md` (if Gemini is selected — via the initial sync)
7. Writes `llm/mcp.json` with chosen MCP preset ids when MCP is included; the initial sync generates `.claude/mcp.json`, `.github/mcp.json`, and/or `.cursor/mcp.json` from that manifest (per selected platforms)
8. Adds `sync:llm-config` scripts to `package.json`
9. Patches `.prettierignore` with `llm/` and `docs/wiki/` to protect prose from formatters
10. Runs an initial sync to generate all platform-specific files

Collections are pre-selected based on the chosen profile. See [Profiles](Profiles) for what each team profile defaults to.

**Example:**

```bash
npx bluetemberg init
npx bluetemberg init ./my-project

# Headless
npx bluetemberg init --non-interactive --profile devops --omit-mcp
npx bluetemberg init --non-interactive --profile pure-infra --omit-mcp --silent
npx bluetemberg init --non-interactive --profile devops --silent
npx bluetemberg init --config ./bluetemberg.init.json ./my-project
```

Programmatic callers can keep using `init(root, opts)`/`scaffold(...)`/`sync(...)` exported from the package (`InitRunOptions` describes the programmatic mirror of the CLI knobs).

## `bluetemberg sync [directory]`

Reads vendor-neutral sources from `llm/` and generates platform-specific files.

**Arguments:**

- `directory` — project root directory (default: current directory)

**Options:**

| Option | Description |
| ------ | ----------- |
| `--check` | Dry-run mode; exits with code 1 if any generated files are out of sync |
| `--dry-run` | Alias for `--check` |
| `--silent` | Suppress all output (useful in scripts and CI) |
| `--prune` | After a successful write pass, delete stale generated files under managed output dirs (ignored with `--check`; see [Configuration](Configuration)) |
| `--verbose` | Emit debug output: resolved source directories (including `extends` entries), per-file origin when multiple sources are active, and any non-fatal warnings |

Before first use of `--prune`, read the short pre-flight list and platform notes under **Stale generated files** in [Configuration](Configuration).

**Example:**

```bash
npx bluetemberg sync
npx bluetemberg sync --check
npx bluetemberg sync --dry-run --silent
npx bluetemberg sync --prune
npx bluetemberg sync ./my-project
```

## `bluetemberg add <package>`

Install a rule pack from the npm registry. See [Registry](Registry) for full details.

```bash
bluetemberg add @company/rules-frontend
bluetemberg add @company/rules-frontend@^1.2.0
```

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
```

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
| `--silent` | Suppress all output |

## `bluetemberg search <query>`

Search npm for rule packs tagged with `bluetemberg-pack`.

```bash
bluetemberg search typescript
bluetemberg search frontend rules --limit 10
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
| 1 | Any sync error was recorded (invalid optional manifests, unknown MCP preset ids, adapter load failures, per-file rule errors, etc.), **or** `--check` found one or more files out of sync |

**Warnings vs errors:** Some issues are non-fatal and appear as warnings — for example, an `extends` entry that references a path or package that does not exist. Warnings are logged and included in the programmatic `SyncResults.warnings` array but do **not** cause exit code 1. Use `--verbose` to see all warnings even when there are no errors.

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
