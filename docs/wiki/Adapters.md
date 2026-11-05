# Adapters and sync extensions

Bluetemberg’s sync engine runs a **pipeline of steps**: vendor-neutral sources under `llm/` are read first; built-in steps validate, normalize, and write provider-specific files through one write helper (`commitPlannedWrite`). Rules use the **transform + copy** path (frontmatter mapping). Steps that need different shapes (MCP JSON, Cursor hooks, Claude commands, Copilot prompt filenames, commands and prompts translated into skills) are separate pipeline stages. You can extend the end of the run with optional **`adapters`** in `bluetemberg.config.json` (ESM modules loaded via `import()`), similar in spirit to small plug-in hooks.

## Trust and security (`adapters`)

Each entry in `adapters` is a module specifier executed with Node’s `import()`. That is **arbitrary code execution** in the same Node process as `bluetemberg sync`, with the same filesystem access as the user running the command.

**Threat model (short):**

- Treat every specifier like a **dependency you execute**: malicious or compromised modules can read secrets, overwrite files, or run subprocesses.
- **Code review** changes to `adapters` and to `bluetemberg.config.json` the same way you would review `package.json` or CI workflow edits.
- **Pin versions** in the consumer project (committed lockfile); avoid relying on floating `latest` for adapter packages.
- Prefer **`file:`** adapters checked into the repo over opaque remote packages when possible.
- In CI, **sync exits with a non-zero code** if any adapter fails to load or if sync records other errors—do not rely on log output alone when using `--silent`.

There is **no** built-in allowlist or sandbox today; optional future guardrails (e.g. only `file:` URLs under the repo root) would be a separate design.

**`sync --prune`:** Built-in prune only removes files that were tracked in the current sync pass via `commitPlannedWrite`. Adapters that write with `writeFileSync` or omit `expectedOutputPaths` on the sink may leave orphans, or may see those files **not** protected from prune if they do not use the shared write helper—see [Configuration](Configuration).

## What is implemented today

| Source | Output | When it runs |
| ------ | ------ | ------------ |
| `llm/rules/` | Per-platform rule files for Cursor, Claude, Copilot, Devin Desktop, Antigravity (`targets.rules`; Devin also gets a transitional `.windsurf/rules/` mirror); a managed block in `AGENTS.md` for Codex and Gemini CLI | Always, per `targets` + `platforms`, after version gating |
| `llm/agents/` | Cursor / Claude / Copilot agent files (`targets.agents`); `.codex/agents/*.toml` for Codex | When source files exist |
| `llm/skills/` | Skill directories (`targets.skills`): `.claude/skills/` for Claude, `.github/skills/` for Copilot, and the shared `.agents/skills/` (written once) for Codex, Devin Desktop, Antigravity, Gemini CLI and Cursor. Cursor gets no dir of its own when Claude is enabled. Pack skills are stamped with pack name, version and integrity in `metadata`. See [Skills dirs per host](#skills-dirs-per-host) | When source directories exist |
| `llm/guardrails/` | `hooks` key of `.claude/settings.json` (composed with `llm/hooks.claude.json`); `.cursor/hooks.json` (composed with `llm/hooks.json`); `.github/hooks/bluetemberg-guardrails.json`; `.devin/hooks.v1.json` (composed with hand-written entries); `[[hooks.PreToolUse]]` block in `.codex/config.toml` | When **claude** / **cursor** / **copilot** / **devin** / **codex** is in `platforms` — see [Guardrails](Guardrails) |
| `llm/hooks.claude.json` | `hooks` key of `.claude/settings.json` | When the file exists in the project's own `llm/` and **claude** is in `platforms` |
| `llm/hooks.json` | `.cursor/hooks.json` | When file exists and **cursor** is in `platforms` |
| `AGENTS.md` | `.github/copilot-instructions.md` (rules block stripped) | When file exists and **copilot** is in `platforms` |
| — | `AGENTS.md` added to `context.fileName` in `.gemini/settings.json` (merged; other settings kept) | When **gemini** is in `platforms` |
| `llm/mcp.json` | Root `.mcp.json` (merged; managed servers tracked in `llm/mcp-managed.json`) for `claude` / `copilot`, `.cursor/mcp.json`; `[mcp_servers.*]` block in `.codex/config.toml`; `mcpServers` merged into `.agents/mcp_config.json` (Antigravity; tracked in the same sidecar) | When file exists and each platform is enabled |
| `llm/commands/*.md` | `.claude/commands/*.md` (deprecated; still written as of 0.20.0, a later release drops it) | When files exist and **claude** is in `platforms` |
| `llm/prompts/*.md` | `.github/prompts/*.prompt.md` (deprecated; still written as of 0.20.0, a later release drops it) | When files exist and **copilot** is in `platforms` |
| `llm/commands/*.md`, `llm/prompts/*.md` | A generated `<name>/SKILL.md` in every skills dir (`targets.skills`) — see [Migrating commands and prompts](Writing-Skills#migrating-commands-and-prompts) | When files exist, for every platform with a skills target; a real skill of the same name wins |
| `llm/skills/`, `llm/agents/`, `llm/rules/` | `plugins/{name}/`, `.claude-plugin/marketplace.json`; `extraKnownMarketplaces` in `.claude/settings.json` when `marketplace.remote` is set | When **claude-marketplace** is in `platforms` — see [Marketplace](Marketplace) |
| `llm/skills/`, `llm/agents/`, `llm/rules/` | In each `plugins/{name}/`: root `plugin.json` (Agent Plugins 1.0), `skills/`, `com.github.copilot/agents/*.agent.md`, `digital.prototyp.bluetemberg/bundle-lock.json`; plus `.claude-plugin/marketplace.json` | When **agent-plugins** is in `platforms` — see [Marketplace](Marketplace#agent-plugins-bundles) |
| `adapters` in config | User-defined ESM modules (last sync step) | When `adapters` is a non-empty array of specifiers |

Nothing runs your hooks or MCP at sync time: the CLI only writes files. `sync --check` diffs the same outputs.

## Skills dirs per host

Every host now reads skills from more than one directory, so writing a copy per tool made the same skill show up twice. Sync writes the fewest dirs that still reach every enabled host. The per-host facts below were checked against each vendor's docs on 2026-11-03, and Cursor's dedupe was also confirmed live with `cursor-agent`.

| Host | Project skills dirs it reads | Same name in two dirs | Sync writes |
| ---- | ---------------------------- | --------------------- | ----------- |
| Claude Code | `.claude/skills/` only | — | `.claude/skills/` |
| Cursor | `.cursor/skills/`, `.claude/skills/`, `.agents/skills/` (and `.codex/skills/`) | Listed once; `.cursor` wins, then `.claude`, then `.agents` (verified live) | nothing of its own when Claude is enabled, else `.agents/skills/` |
| Copilot code review | `.github/skills/` only | — | `.github/skills/` |
| VS Code, Copilot CLI, Copilot cloud agent | `.github/skills/`, `.claude/skills/`, `.agents/skills/` | VS Code lists both | `.github/skills/` (shared with code review) |
| OpenAI Codex | `.agents/skills/` | Both can appear | `.agents/skills/` |
| Antigravity | `.agents/skills/` (and legacy `.agent/skills/`) | Undocumented | `.agents/skills/` |
| Gemini CLI | `.agents/skills/` and `.gemini/skills/` | `.agents` wins | `.agents/skills/` |
| Devin Desktop | `.devin/skills/`, `.agents/skills/`, legacy `.windsurf/skills/` | Undocumented | `.agents/skills/` |

With the default platforms (`cursor`, `claude`, `copilot`), sync writes `.claude/skills/` and `.github/skills/`. With `cursor` and `copilot` but no `claude`, it writes `.agents/skills/` and `.github/skills/`. Cursor reads the Claude copy. The duplicate that remains is in VS Code and Copilot CLI, which read both dirs. It cannot be avoided without losing skills elsewhere: Claude Code reads only `.claude/skills/`, and Copilot code review reads only `.github/skills/`.

**Platform-limited skills.** A skill limited to some platforms (catalog or frontmatter `platforms`) goes to a shared dir only when one of that dir's own readers is allowed. Cursor reads `.claude/skills/` and `.agents/skills/` alongside their owners, so it never pulls a skill into either one. A Cursor-only skill goes to `.cursor/skills/` instead, which no other host reads. Under scoped `extends` entries, Cursor counts as a writer of a dir only when it has no covering dir in its own group, so a Codex-scoped entry doesn't split `.agents/skills/` from a Cursor that reads Claude's dir.

The per-host user-only switches for commands and prompts migrated to skills ([Migrating commands and prompts](Writing-Skills#migrating-commands-and-prompts)) are written only where their host reads them. `triggers: [user]` goes to the dir Devin reads, and `agents/openai.yaml` to the dir Codex reads; both are `.agents/skills/`.

**Upgrading.** Earlier versions also wrote `.cursor/skills/`. A `targets.skills.cursor` entry that still points there (what `init` wrote) means the default. The old generated copies are reported as `STALE:` by `sync --check`. A plain `sync` prints a note while they are left, because Cursor prefers `.cursor/skills/` over the fresh copies. Run `bluetemberg sync --prune` once. It removes a copy's `SKILL.md` only when it carries the banner, and a supporting file only when it is identical to the live copy. A hand-written skill, or a file someone added inside a copy, stays and is listed. Sync also no longer overwrites a skill dir in a target that holds an unbannered `SKILL.md`. It warns instead, so delete an old copy from before banners existed by hand.

**Provenance.** A skill synced from a registry pack records where it came from in the Agent Skills `metadata` map: `bluetemberg-pack`, `bluetemberg-version` and `bluetemberg-integrity`, the lockfile's tarball hash that `bluetemberg verify` checks. The values come from the lockfile, not from the output, so the stamp never changes the hash it records. A skill's own `metadata` entries are kept.

## Optional npm / file adapters

`bluetemberg.config.json` may include `"adapters": ["my-package", "file:./tools/btg-adapter.mjs"]`. Each specifier is passed to `import()`. The module must **`export default`** either:

- a **function** `(ctx, recordError) => void | Promise<void>`, or
- an object with a **`run`** method of that shape.

Use the **`AdapterContext`** type from `bluetemberg` (or `bluetemberg/sync/adapter-contract`). For drift-safe writes inside an adapter, import **`commitPlannedWrite`** from `bluetemberg/sync/pipeline` so `--check` stays accurate. It creates parent directories itself in write mode; do not `mkdir` output dirs ahead of it, or `--check` stops being read-only.

**Output paths:** Always pass an **absolute** path, or build one with `join(ctx.root, 'relative', 'path')`. Do **not** pass a bare relative path: `commitPlannedWrite` resolves paths for pruning and drift checks, and a relative path is resolved against the process working directory, not the project root—so `--check` and `sync --prune` can mis-track adapter outputs.

The programmatic **`sync()`** API is **async** (it `await`s adapter modules).

## Design principles

- **Vendor-neutral sources** — Prefer plain Markdown or JSON in `llm/` so the repo stays useful without Bluetemberg.
- **Deterministic output** — Same inputs produce the same files; CI can gate on `--check`.
- **Platform gates** — If a platform is not listed in `platforms`, its adapter does not emit files (no surprise `.cursor` output when the team only uses Claude).
- **Canonical platform ids** — Adapters receive `platforms` with aliases already resolved: a config listing `"windsurf"` reaches the adapter as `"devin"` (Devin Desktop, formerly Windsurf). Gate on `devin`, not `windsurf`.

## Roadmap (optional follow-ups)

- Richer validation for Cursor hook event names as Cursor’s schema stabilizes.
- First-party adapter presets shipped as optional npm packages.

See [Architecture](Architecture) for the high-level init/sync flow and [Configuration](Configuration) for `bluetemberg.config.json`.
