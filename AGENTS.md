# Bluetemberg

Vendor-neutral AI tooling scaffolder and sync engine for Cursor, Claude Code, and GitHub Copilot.

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
```

## AI Config Architecture

Source of truth for all AI tool configuration lives in `llm/`:

- `llm/rules/` — scoped rules (frontmatter: `description`, `scope`)
- `llm/agents/` — specialist agent definitions
- `llm/skills/` — on-demand skill workflows

Run `npm run sync:llm-config` to generate tool-specific files in `.cursor/rules/`, `.cursor/agents/`, `.cursor/skills/`, `.claude/`, `.github/instructions/`, `.github/agents/`, `.github/skills/`, and related paths. These generated files should not be edited directly.

## Project structure

- `src/init/` — Interactive wizard (prompts, presets, scaffold)
- `src/sync/` — Sync engine (config loading, frontmatter transforms, file writing)
- `src/registry/` — Pack install/update against the npm registry
- `src/utils/` — Shared filesystem helpers
- `src/types.ts` — All shared TypeScript types
- `bin/cli.js` — CLI entry point (Commander)
- `tests/` — Vitest tests (sync + transform)
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
- Use `console.log` for user-facing output outside of `init/index.ts` and `sync/index.ts`
