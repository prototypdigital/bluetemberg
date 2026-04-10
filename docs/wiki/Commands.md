# Commands

## `bluetemberg init [directory]`

Interactive wizard that scaffolds AI tooling into a project.

**Arguments:**

- `directory` — target directory (default: current directory)

**What it does:**

1. Asks you to pick a **team profile** (sets smart defaults for all subsequent choices)
2. Asks for project name, description, and package manager
3. Asks you to pick platforms, rules, agents, skills, and MCP servers
4. Creates `llm/` directory with selected starter content
5. Generates `bluetemberg.config.json`
6. Creates `AGENTS.md`, `CLAUDE.md` (if Claude selected), and `GEMINI.md` (if Gemini selected, via the initial sync)
7. Writes `llm/mcp.json` with chosen MCP preset ids (if MCP selected); the initial sync step generates `.claude/mcp.json`, `.github/mcp.json`, and/or `.cursor/mcp.json` from that manifest (per selected platforms)
8. Adds `sync:llm-config` scripts to `package.json`
9. Patches `.prettierignore` with `llm/` and `docs/wiki/` to protect prose from formatters
10. Runs an initial sync to generate all platform-specific files

Universal guardrail rules are always included and shown as non-deselectable in the rules step. See [Profiles](Profiles) for what each team profile pre-checks.

**Example:**

```bash
npx @prototypdigital/bluetemberg init
npx @prototypdigital/bluetemberg init ./my-project
```

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
