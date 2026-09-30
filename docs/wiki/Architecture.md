# Architecture

## Overview

Bluetemberg has two main components: the **init wizard** and the **sync engine**.

```mermaid
flowchart TD
    subgraph init ["bluetemberg init"]
        A[Prompts\ninquirer] --> B[Scaffold files\nllm/ + config + docs]
        B --> B2[Patch .prettierignore\nprotect llm/ from formatters]
        B2 --> C[Run sync engine]
    end

    subgraph sync ["bluetemberg sync"]
        D[Load config\nbluetemberg.config.json] --> E[Read llm/ sources\nrules · agents · skills · mcp · hooks · commands · prompts]
        D --> L[Optional adapters\nimport from config]
        E --> F{Type?}
        F -->|rules| G[Transform\nfrontmatter]
        F -->|agents| H[Copy verbatim]
        F -->|skills| H
        F -->|commands| H
        F -->|prompts| H
        F -->|mcp.json| J[Resolve MCP entries\nper platform]
        F -->|hooks.json| K[Validate\nCursor shape]
        F -->|hooks.claude.json| K2[Validate events\nproject-local only]
        G --> I[Write target files]
        H --> I
        J --> I
        K --> I
        K2 --> I
        L --> I
    end

    C --> D
```

## Source directory structure

```
llm/
├── rules/              # Markdown with YAML frontmatter
│   ├── coding-standards.md
│   └── no-console-log.md
├── agents/             # Verbatim markdown (no transform)
│   └── frontend-specialist.md
├── skills/             # Directory per skill, each with SKILL.md
│   └── patterns/
│       └── SKILL.md
├── mcp.json            # Optional: preset ids and/or inline servers → per-platform mcp.json
├── hooks.json          # Optional: Cursor hooks → .cursor/hooks.json
├── hooks.claude.json   # Optional: Claude Code hooks → hooks key of .claude/settings.json (project-local only; packs cannot ship these)
├── commands/           # Optional: Claude slash commands → .claude/commands/*.md
└── prompts/            # Optional: Copilot prompts → .github/prompts/*.prompt.md
```

For optional sync extensions, MCP/hooks details, and roadmap, see [Adapters](Adapters).

## Frontmatter transform

The core of the sync engine. Rules get platform-specific frontmatter; agents and skills are copied as-is. (OpenAI Codex is the exception — its rules are folded into `AGENTS.md` as plain markdown with no transform; see [Special sync](#special-sync-agentsmd-and-openai-codex).)

```mermaid
flowchart LR
    src["llm/rules/rule.md\n---\ndescription: ...\nscope: '**'\n---"]

    src --> cursor[".cursor/rules/rule.mdc\n---\ndescription: ...\nalwaysApply: true\n---"]
    src --> claude[".claude/rules/rule.md\n---\ndescription: ...\npaths: ['**']\n---"]
    src --> copilot[".github/instructions/rule.instructions.md\n---\ndescription: ...\napplyTo: '**'\n---"]
```

| Source field      | Cursor output       | Claude output       | Copilot output      |
| ----------------- | ------------------- | ------------------- | ------------------- |
| `description`     | `description`       | `description`       | `description`       |
| `scope: '**'`     | `alwaysApply: true` | `paths: ['**']`     | `applyTo: '**'`     |
| `scope: 'src/**'` | `globs: ['src/**']` | `paths: ['src/**']` | `applyTo: 'src/**'` |

## File extension mapping

| Source     | Cursor     | Claude     | Copilot                |
| ---------- | ---------- | ---------- | ---------------------- |
| `rule.md`  | `rule.mdc` | `rule.md`  | `rule.instructions.md` |
| `agent.md` | `agent.md` | `agent.md` | `agent.agent.md`       |
| `SKILL.md` | `SKILL.md` | `SKILL.md` | `SKILL.md`             |

## Rule tiers

Rules have three intent levels, not just on/off:

| Tier | Behavior | Examples |
| ---- | -------- | -------- |
| **Collection default** | Pre-checked for a given team profile; the whole collection is toggled | `git`, `security`, `docs` (all profiles); `typescript` (frontend/backend/fullstack) |
| **Collection optional** | Available but not pre-checked for the profile | `nextjs` (backend), `devops` (frontend) |

Collections are curated in `src/init/presets.ts` as `RULE_COLLECTION_OVERLAYS` (id, display name, package name, description). Their **rule ids and profile tags are resolved from the catalog** (`catalog.json`) at load time via `resolveRuleCollections` — the engine does not hand-declare them, so they can never drift from the published packs. Agents and skills resolve the same way (`AGENT_OVERLAYS` / `SKILL_OVERLAYS` + `resolveAgents` / `resolveSkills`). The catalog is read from the project cache (`.bluetemberg/catalog.json`, refreshed on `install`/`update`/`add`) and falls back to a snapshot committed at `src/catalog/catalog.json` (run `npm run sync:catalog` to refresh it). See [Profiles](Profiles) for the full matrix.

## Config resolution

```mermaid
flowchart TD
    A[bluetemberg sync] --> B{bluetemberg.config.json\nexists?}
    B -->|yes| C[Use platforms + source\n+ targets from file]
    B -->|no| D[Use defaults\ncursor, claude, copilot · llm/ · standard paths]
    C --> E[Run sync]
    D --> E
```

## Special sync: AGENTS.md and OpenAI Codex

`AGENTS.md` at the repo root is copied to `.github/copilot-instructions.md` (GitHub Copilot) and `GEMINI.md` (Gemini CLI) — this is how those tools read project-level context.

**OpenAI Codex** reads `AGENTS.md` natively, so the monolithic instructions need no derivation. Codex is also the one target whose rules do **not** go through the frontmatter transform: scoped rules from `llm/rules/` are folded into a fenced *managed block* in `AGENTS.md`, agents become per-file TOML under `.codex/agents/`, and MCP servers become a `[mcp_servers.*]` managed block in `.codex/config.toml`. Skills use the vendor-neutral `.agents/skills/`. Managed blocks (`src/sync/managed-block.ts`) preserve hand-authored content outside the markers and keep `sync --check` idempotent; the Codex rules block is stripped from the derived Copilot/Gemini instruction files.

### Why the rules block is Codex-only

The managed rules block is written only when `codex` is in `platforms`. A Claude-, Cursor-, or Copilot-only project's `AGENTS.md` stays hand-authored project context (name, architecture, boundaries) with no rules in it. That is on purpose:

- Every platform with its own scoped-rules directory (`.claude/rules/`, `.cursor/rules/`, `.github/instructions/`, `.gemini/context/`, `.windsurf/rules/`) already gets each rule with its `scope` turned into a path filter, so it loads only for matching files.
- Most of those tools also read `AGENTS.md` itself. Folding the rules into it would load every rule twice, once scoped and once always-on. That is the same reason the block is stripped from `copilot-instructions.md` and `GEMINI.md`.
- Codex has no per-file rule API, so `AGENTS.md` is the only place its rules can go.

**Known overlap:** when `codex` is selected alongside `claude` or `cursor`, both read the block through `AGENTS.md` as well as through their own scoped rules. Neither tool offers a way to skip part of `AGENTS.md`, so sync leaves this alone.

### Claude Code and AGENTS.md

Since [v2.1.277](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), Claude Code reads `AGENTS.md` natively, but only when there is no `CLAUDE.md`. From [Anthropic's docs](https://code.claude.com/docs/en/memory#agents-md):

| Repository has | Claude Code reads |
| --- | --- |
| `AGENTS.md`, and no `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` at or above the working directory | `AGENTS.md` |
| `AGENTS.md` plus any of those files | the `CLAUDE.md` files **only** |
| a `CLAUDE.md` that imports `@AGENTS.md` (or is a symlink to it) | `CLAUDE.md`, with `AGENTS.md` pulled in once |

`bluetemberg init` scaffolds the third row: a `CLAUDE.md` whose first line is `@AGENTS.md`, followed by Claude-specific notes. Anthropic recommends keeping this pattern. The import never loads `AGENTS.md` twice, and it still works in sessions that can't read `AGENTS.md` natively (Claude Code before v2.1.277, a disabled built-in `agents-md` plugin, or the first session after upgrading). Before v2.1.281, Bedrock, Vertex AI, Foundry, LLM-gateway, and telemetry-disabled sessions were in that group too.

`sync` doesn't own `CLAUDE.md`, but when `claude` is selected it checks the second row. If a root `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` exists and none of them reach `AGENTS.md` by `@` import (followed up to four hops, ignoring code spans and fences) or symlink, sync records a **warning**. It does not fail `--check`. Without the warning, `AGENTS.md` would drop out of Claude's context and nothing would say so. A personal, gitignored `CLAUDE.local.md` with no `CLAUDE.md` beside it is enough to cause this.

**Tip:** To load both files unconditionally, set Claude Code's **Project instructions** to `claude-md-and-agents-md` in `/config`, or under `pluginConfigs["agents-md@builtin"].options.instructionFiles` in `~/.claude/settings.json` or managed settings. Claude Code ignores that key in a project's `.claude/settings.json`, so it's a per-user or per-org choice that sync can't make for a team.

### Malformed markers

Markers are paired positionally: each `BEGIN` is matched with the first `END` **after** it. An unpaired marker — a stray `END` with no `BEGIN` before it, a `BEGIN` with no `END` after it, or a `BEGIN` nested inside an open block — is what a hand-resolved merge conflict tends to leave behind, and there is no safe way to guess where the generated region was meant to start or stop. Sync therefore records an error naming the file, leaves it byte-for-byte untouched, and exits 1 with the fix in the message. Repair the markers (delete the stray one, or restore its pair) and re-run.

Duplicated blocks — both sides of a conflict kept, each with a matching pair — need no manual repair: the fenced region is generated content by definition, so sync collapses them into the first block and preserves everything between them.

Sync also refuses to **author** an unpairable block: a rule whose body quotes `<!-- BEGIN BLUETEMBERG MANAGED RULES -->` or its END counterpart verbatim is rejected before the first write, with an error naming the rule file. Without that check the marker would land inside the generated block, and no later run could pair it — not even after the rule was deleted, because the wreckage would already be on disk. Reword the rule so the literal marker does not appear (dropping the comment delimiters is enough).

## Check mode

`bluetemberg sync --check` performs a dry run: reads all sources, generates expected output in memory, compares against existing files. If any differ, it reports them and exits with code 1. No files are written and no directories are created — the check leaves the working tree byte-for-byte untouched. Comparisons **normalize line endings** (CRLF vs LF) so check mode is less sensitive to platform checkout settings.

## Prune (optional)

`bluetemberg sync --prune` (write mode only) removes generated files under the **managed** output directories that were **not** produced in the current pass—useful after deleting or renaming sources under `llm/`. Prune runs only when the sync finishes with **no recorded errors**. See [Configuration](Configuration) for caveats (adapters, hand-edited files, `targets` paths).
