# Bluetemberg

Distributes AI coding standards as versioned, integrity-verified npm packs, routed by team profile and stack version, and emits `AGENTS.md` plus native config for Cursor, Claude Code, GitHub Copilot, Gemini CLI (Enterprise), Antigravity CLI, Devin Desktop (formerly Windsurf), and OpenAI Codex. This repo is the engine; all content lives in bluetemberg-packs.

## Commands

```bash
npm run dev          # TypeScript watch mode
npm run build        # Production build (tsc)
npm run test         # Run vitest
npm run test:watch   # Vitest in watch mode
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier format
npm run typecheck    # Type-check without emit
npm run sync:llm-config   # Sync rules -> all AI tool directories
npm run sync:catalog      # Refresh the committed catalog snapshot from the packs repo
```

## AI Config Architecture

Source of truth for all AI tool configuration lives in `llm/`:

- `llm/rules/` — scoped rules (frontmatter: `description`, `scope`)
- `llm/agents/` — specialist agent definitions
- `llm/skills/` — on-demand skill workflows

Run `npm run sync:llm-config` to generate tool-specific files in `.cursor/rules/`, `.cursor/agents/`, `.cursor/skills/`, `.claude/`, `.github/instructions/`, `.github/agents/`, `.github/skills/`, and related paths. These generated files should not be edited directly.

## Project structure

- `src/init/` — Interactive wizard (prompts, presets, scaffold, switch-profile)
- `src/sync/` — Sync engine (config loading, frontmatter transforms, per-platform emitters, guardrails, hooks, marketplace, prune)
- `src/registry/` — Pack install/update/verify against the npm registry (auth, signatures, lockfile)
- `src/catalog/` — Catalog loader + committed snapshot (single source for pack ids/profiles)
- `src/stacks/` — Stack detection, version matching, coverage, org scanning
- `src/sources/` — External rule sources (GitHub, PRPM, cursor.directory) and their translators
- `src/mcp/` — MCP server exposing detection/coverage tools, plus the MCP preset registry
- `src/preview/` — `bluetemberg preview`: what a profile would install
- `src/utils/` — Shared filesystem helpers
- `src/types.ts` — All shared TypeScript types; `src/help-json.ts` — `--help --json`; `src/cli-guards.ts` — CLI flag validation
- `bin/cli.js` — CLI entry point (Commander)
- `scripts/` — Maintainer scripts (`sync-catalog`, site build) and `scripts/hooks/` (this repo's own Claude Code hooks)
- `site/` — The GitHub Pages landing page
- `tests/` — Vitest tests
- `docs/wiki/` — GitHub Wiki source

All user-facing content (rules, agents, skills, guardrails) lives in [bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs) — this repo ships no content, only the engine.

## Conventions

- ESM-only (`"type": "module"`)
- Strict TypeScript with `consistent-type-imports`
- Early returns over nesting; guard clauses first
- Single-purpose functions; extract helpers when >20 lines
- No `any`; use `unknown` then narrow

## Boundaries

### Always

- Run lint after editing code files
- Follow existing patterns and conventions
- Update docs/wiki if changing user-facing behavior

### Ask First

- Adding new dependencies
- Changing the config schema (`BlueprintConfig`)
- Modifying the init wizard flow

### Never

- Edit generated files (`.cursor/rules/`, `.cursor/agents/`, `.cursor/skills/`, `.claude/`, `.github/instructions/`, `.github/agents/`, `.github/skills/`)
- Commit `.env` or secrets
- Print user-facing output from library code (`src/utils`, `src/stacks`, `src/catalog`, `src/sync/*` emitters); it goes through the command module's `log` (init, sync, registry, sources, switch-profile) so `--silent` and tests can capture it
