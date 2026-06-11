# Bluetemberg

Scaffold vendor-neutral AI tooling config (rules, agents, skills) with cross-platform sync for Cursor, Claude Code, GitHub Copilot, Gemini CLI, and Windsurf.

## What is Bluetemberg?

Bluetemberg is an open-source CLI tool (published on npm as `bluetemberg`, MIT) that sets up and maintains AI assistant configuration across multiple platforms from a single source of truth. Write your rules, agent definitions, and skills once in `llm/`, and Bluetemberg syncs them to Cursor, Claude, GitHub Copilot, Gemini CLI, and Windsurf with the correct format for each.

Rules are self-contained Markdown files — the AI reads them directly, no cross-file dependencies. The sync engine only transforms frontmatter for each platform. `sync --check` in CI catches any drift before it ships.

If you're wondering why this exists or how it's different from maintaining platform configs by hand, start with [Why Bluetemberg](Why).

## Quick links

- [Why Bluetemberg](Why) — design philosophy and what problem it solves
- [Installation](Installation) — install from public npm (no auth or registry config)
- [Commands](Commands) — CLI reference for `init` and `sync`
- [Configuration](Configuration) — `bluetemberg.config.json` schema
- [Profiles](Profiles) — team profiles and what each one includes
- [Writing Rules](Writing-Rules) — how to write vendor-neutral rules
- [Writing Agents](Writing-Agents) — agent definition format
- [Writing Skills](Writing-Skills) — SKILL.md format
- [Writing Hooks](Writing-Hooks) — Cursor `hooks.json` in `llm/`
- [Guardrails](Guardrails) — declarative checks enforced as platform-native hooks
- [Writing Commands](Writing-Commands) — Claude Code slash commands in `llm/commands/`
- [Writing Prompts](Writing-Prompts) — Copilot prompt files in `llm/prompts/`
- [Architecture](Architecture) — how the sync engine works
- [Adapters](Adapters) — sync extensions, platform gates, roadmap
- [Consumer Setup](Consumer-Setup) — set up a downstream project
- [Registry](Registry) — install community & official packs (official packs live in [bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs))
- [Sources](Sources) — pull rules from GitHub, PRPM, or cursor.directory and translate them to native format
- [Contributing](Contributing) — dev setup, adding templates, and release process


