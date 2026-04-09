# Changelog

## Unreleased

### Breaking changes

- **CLI:** `bluetemberg sync` exits with code **1** when sync records any error (e.g. invalid optional manifests, unknown MCP preset ids, adapter failures), not only when `--check` detects drift. Pipelines that assumed a zero exit despite logged errors must treat the exit code as the source of truth (especially with `--silent`).

### Features

- **Sync:** default targets now include **Cursor** for `llm/agents` (`.cursor/agents/*.md`) and `llm/skills` (`.cursor/skills/*/SKILL.md`), matching Cursor subagents and Agent Skills layouts. Repos with explicit `targets.agents` / `targets.skills` must add `cursor` entries (or drop those sections) to emit there.
- **This repo:** `.cursor/agents/` and `.cursor/skills/` are added to `.gitignore` (generated from `llm/`), consistent with `.cursor/rules/`.
- **`sync --prune`:** optional removal of stale generated files under managed output directories after a successful write pass (no-op with `--check`).
- **Config:** `targets` in `bluetemberg.config.json` is validated at load time (platform keys, non-empty `dir`, and `ext` for rules/agents).
- **`--check`:** compares files with newline normalization (CRLF vs LF) to reduce false positives on Windows.

### Documentation

- Wiki: exit codes, `.gitattributes` guidance, prune behavior, expanded adapter security notes.

## [0.1.3](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.1.2...bluetemberg-v0.1.3) (2026-04-08)

### Features

* add docs-parity universal rule and update docs ([#6](https://github.com/prototypdigital/bluetemberg/issues/6)) ([b8a7277](https://github.com/prototypdigital/bluetemberg/commit/b8a72771ac67dba2eafe87b906b9475025533d65))

## [0.1.2](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.1.1...bluetemberg-v0.1.2) (2026-04-08)

### Features

* introduce universal guardrails layer ([#4](https://github.com/prototypdigital/bluetemberg/issues/4)) ([007b04e](https://github.com/prototypdigital/bluetemberg/commit/007b04ee697f3e0dc3bd3240f867d09f09b000c1))

## [0.1.1](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.1.0...bluetemberg-v0.1.1) (2026-04-08)

### Features

* add production-grade tooling and documentation ([92c1c2c](https://github.com/prototypdigital/bluetemberg/commit/92c1c2c8e62e145a88c96baec7cb04be937ad189))
* expand template library, team profiles, code quality, and self-dogfooding ([8832e49](https://github.com/prototypdigital/bluetemberg/commit/8832e4900aedaa2cf0dc920d8267ec85fc06794c))
* initial implementation of blueprint CLI ([0dfd1e9](https://github.com/prototypdigital/bluetemberg/commit/0dfd1e9b971da996e88ced2814670584a3a040c3))

### Bug Fixes

* initialize wiki if it does not exist in sync-wiki workflow ([5df6f50](https://github.com/prototypdigital/bluetemberg/commit/5df6f50a896342646b3399ee9ccb14e1eaf95641))
