# Bluetemberg

AI coding standards, shipped like a dependency: version-locked, integrity-verified, signed, and routed to the right engineer and the right stack version. Emits `AGENTS.md` plus native config for Cursor, Claude Code, GitHub Copilot, Gemini CLI (Enterprise), Antigravity CLI, Devin Desktop (formerly Windsurf), and OpenAI Codex.

## What is Bluetemberg?

Bluetemberg is an open-source CLI (published on npm as `bluetemberg`, MIT) that installs AI coding rules, agents, skills and guardrails from versioned npm packs into a project, verifies them on the way in, selects them by team profile and detected stack version, and writes them out in the format each tool reads. Your own content lives in `llm/` and always wins over a pack.

Rules are self-contained Markdown files — the AI reads them directly, no cross-file dependencies. The sync engine only transforms frontmatter for each platform. `sync --check` in CI catches any drift before it ships.

If you're wondering why this exists or how it's different from maintaining platform configs by hand, start with [Why Bluetemberg](Why).

## Quick links

- [Why Bluetemberg](Why) — the distribution problem it solves and the guarantees it gives
- [Installation](Installation) — install from public npm (no auth or registry config)
- [Commands](Commands) — CLI reference for `init` and `sync`
- [Configuration](Configuration) — `bluetemberg.config.json` schema
- [Profiles](Profiles) — team profiles and what each one includes
- [Stacks & Versioning](Stacks) — version-aware routing, detection, and the versioning strategy
- [Writing Rules](Writing-Rules) — how to write vendor-neutral rules
- [Writing Agents](Writing-Agents) — agent definition format
- [Writing Skills](Writing-Skills) — SKILL.md format
- [Writing Hooks](Writing-Hooks) — Cursor `hooks.json` and Claude Code `hooks.claude.json` in `llm/`
- [Marketplace](Marketplace) — Claude Code plugin output for zero-install onboarding
- [Guardrails](Guardrails) — declarative checks enforced as platform-native hooks
- [Writing Commands](Writing-Commands) — Claude Code slash commands in `llm/commands/`
- [Writing Prompts](Writing-Prompts) — Copilot prompt files in `llm/prompts/`
- [Architecture](Architecture) — how the sync engine works
- [Adapters](Adapters) — sync extensions, platform gates, roadmap
- [Consumer Setup](Consumer-Setup) — set up a downstream project
- [Registry](Registry) — install community & official packs (official packs live in [bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs))
- [Sources](Sources) — pull rules from GitHub, PRPM, or cursor.directory and translate them to native format
- [Contributing](Contributing) — dev setup, adding packs, and release process


