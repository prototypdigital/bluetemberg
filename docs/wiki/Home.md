# Bluetemberg

Scaffold vendor-neutral AI tooling config (rules, agents, skills) with cross-platform sync for Cursor, Claude Code, and GitHub Copilot.

## What is Bluetemberg?

Bluetemberg is an internal CLI tool that sets up and maintains AI assistant configuration across multiple platforms from a single source of truth. Write your rules, agent definitions, and skills once in `llm/`, and Bluetemberg syncs them to Cursor, Claude, and GitHub Copilot with the correct format for each.

## Quick links

- [Installation](Installation) — set up GitHub Packages auth and install
- [Commands](Commands) — CLI reference for `init` and `sync`
- [Configuration](Configuration) — `bluetemberg.config.json` schema
- [Writing Rules](Writing-Rules) — how to write vendor-neutral rules
- [Writing Agents](Writing-Agents) — agent definition format
- [Writing Skills](Writing-Skills) — SKILL.md format
- [Architecture](Architecture) — how the sync engine works
- [Consumer Setup](Consumer-Setup) — set up a downstream project
- [Contributing](Contributing) — dev setup and release process
