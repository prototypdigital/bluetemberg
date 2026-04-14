# Bluetemberg

Scaffold vendor-neutral AI tooling config (rules, agents, skills) with cross-platform sync for Cursor, Claude Code, and GitHub Copilot.

## What is Bluetemberg?

Bluetemberg is an internal CLI tool that sets up and maintains AI assistant configuration across multiple platforms from a single source of truth. Write your rules, agent definitions, and skills once in `llm/`, and Bluetemberg syncs them to Cursor, Claude, and GitHub Copilot with the correct format for each.

Rules are self-contained Markdown files — the AI reads them directly, no cross-file dependencies. The sync engine only transforms frontmatter for each platform. `sync --check` in CI catches any drift before it ships.

If you're wondering why this exists or how it's different from maintaining platform configs by hand, start with [Why Bluetemberg](Why).

## Quick links

- [Why Bluetemberg](Why) — design philosophy and what problem it solves
- [Installation](Installation) — set up GitHub Packages auth and install
- [Commands](Commands) — CLI reference for `init` and `sync`
- [Configuration](Configuration) — `bluetemberg.config.json` schema
- [Profiles](Profiles) — team profiles and what each one includes
- [Writing Rules](Writing-Rules) — how to write vendor-neutral rules
- [Writing Agents](Writing-Agents) — agent definition format
- [Writing Skills](Writing-Skills) — SKILL.md format
- [Writing Hooks](Writing-Hooks) — Cursor `hooks.json` in `llm/`
- [Writing Commands](Writing-Commands) — Claude Code slash commands in `llm/commands/`
- [Writing Prompts](Writing-Prompts) — Copilot prompt files in `llm/prompts/`
- [Architecture](Architecture) — how the sync engine works
- [Adapters](Adapters) — sync extensions, platform gates, roadmap
- [Consumer Setup](Consumer-Setup) — set up a downstream project
- [Registry](Registry) — community rule packs and official collections
- [Contributing](Contributing) — dev setup, adding templates, and release process


