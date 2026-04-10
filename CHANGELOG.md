# Changelog

## Unreleased

### Breaking changes

- **CLI:** `bluetemberg sync` exits with code **1** when sync records any error (e.g. invalid optional manifests, unknown MCP preset ids, adapter failures), not only when `--check` detects drift. Pipelines that assumed a zero exit despite logged errors must treat the exit code as the source of truth (especially with `--silent`).

### Features

- **Sync:** default targets now include **Cursor** for `llm/agents` (`.cursor/agents/*.md`) and `llm/skills` (`.cursor/skills/*/SKILL.md`), matching Cursor subagents and Agent Skills layouts.
  - **Repos with an explicit `bluetemberg.config.json`** that sets `targets.agents` / `targets.skills`: add `cursor` entries (or drop those sections entirely to inherit defaults) to emit cursor output.
  - **Repos without a config file** (or one that omits `targets`): if `cursor` is already listed in `platforms` and `llm/agents/` or `llm/skills/` sources exist, the next `sync` will write `.cursor/agents/` and `.cursor/skills/` output automatically. Add an explicit `bluetemberg.config.json` with `targets` if you need to opt out or pin the directories.
- **This repo:** `.cursor/agents/` and `.cursor/skills/` are added to `.gitignore` (generated from `llm/`), consistent with `.cursor/rules/`.
- **`sync --prune`:** optional removal of stale generated files under managed output directories after a successful write pass (no-op with `--check`).
- **Config:** `targets` in `bluetemberg.config.json` is validated at load time (platform keys, non-empty `dir`, and `ext` for rules/agents).
- **`--check`:** compares files with newline normalization (CRLF vs LF) to reduce false positives on Windows.

### Documentation

- Wiki: exit codes, `.gitattributes` guidance, prune behavior, expanded adapter security notes.

## [0.2.1](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.0...bluetemberg-v0.2.1) (2026-04-10)


### Features

* **platform:** add Gemini CLI as a supported target platform ([887dc35](https://github.com/prototypdigital/bluetemberg/commit/887dc35a6ee2a5f97df54cf45cd08af2a8d6dea7))
* **platform:** add Gemini CLI as a supported target platform ([d8bb39f](https://github.com/prototypdigital/bluetemberg/commit/d8bb39f565669b15a58a057b5cde1fcd53d4501c))
* **sync:** add --verbose flag and SyncResults.warnings ([79fdeb0](https://github.com/prototypdigital/bluetemberg/commit/79fdeb0e961d4d94792179448b604ef3def9f6bd))
* **sync:** add --verbose flag and warnings to SyncResults ([4b93f07](https://github.com/prototypdigital/bluetemberg/commit/4b93f070b6f5c284ac83a9ed7fb1682416b5f5fa))
* **sync:** add extends field for merging shared/remote source directories ([a23af07](https://github.com/prototypdigital/bluetemberg/commit/a23af07f6eb32048ea9565a52497b21eb0b96dad))
* **sync:** add extends field for shared/remote source merging ([735ee2a](https://github.com/prototypdigital/bluetemberg/commit/735ee2a9624ff4467ada4d94cf11f1ec30a7aa19))


### Bug Fixes

* **pr-27:** graceful config errors, preserve adapters, fix skills dir, add tests ([6c94c89](https://github.com/prototypdigital/bluetemberg/commit/6c94c89ee6dc734c79e58665e854a0a1bf5c50bd))
* **rules:** add branch naming convention to git-workflow rule ([b3ed0fe](https://github.com/prototypdigital/bluetemberg/commit/b3ed0fe28bf3b8f8440b1afec4284b3b243b70e8))
* **rules:** add branch naming convention to git-workflow rule ([5fd0ec9](https://github.com/prototypdigital/bluetemberg/commit/5fd0ec9fc6ff51f8b642e98684828138b364c0f8))
* **scaffold:** add tier-2 tests and fix init bugs ([01ee4f9](https://github.com/prototypdigital/bluetemberg/commit/01ee4f92061843995c8ee250e48624e3ae583b3a))

## [0.2.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.1.3...bluetemberg-v0.2.0) (2026-04-10)


### ⚠ BREAKING CHANGES

* **sync:** harden exit codes, targets validation, prune, check newlines
* Programmatic sync() returns a Promise; use await sync(root, options).

### Features

* async sync, adapter pipeline, and multi-platform extensions ([44409b4](https://github.com/prototypdigital/bluetemberg/commit/44409b4198007cda422467c2e33e84ec6d7d1a94))
* **sync:** add cursor default targets for agents and skills ([838699b](https://github.com/prototypdigital/bluetemberg/commit/838699bd75b512298cba23d984053595a1134c98))
* **sync:** add cursor default targets for agents and skills ([fe8112e](https://github.com/prototypdigital/bluetemberg/commit/fe8112e23c85513c07a66827a3c143e902fa6dd7))
* **sync:** harden exit codes, targets validation, prune, check newlines ([63695d1](https://github.com/prototypdigital/bluetemberg/commit/63695d14b271586ddbecd5e35d7937a117fa9d02))


### Bug Fixes

* relax CODEOWNERS to org dev team ([e02c468](https://github.com/prototypdigital/bluetemberg/commit/e02c468c46942a35f5d2c5f6ce0c9078b745b3e7))
* relax CODEOWNERS to org dev team ([979d4f8](https://github.com/prototypdigital/bluetemberg/commit/979d4f8d9fa52054d91960d945bf4243686b259a)), closes [#10](https://github.com/prototypdigital/bluetemberg/issues/10)
* **review:** address PR [#22](https://github.com/prototypdigital/bluetemberg/issues/22) review feedback ([9d5fd99](https://github.com/prototypdigital/bluetemberg/commit/9d5fd99383d6a57bf93279c9cff83beb81d49d16))
* **target-filtering:** narrow undefined entries explicitly instead of asserting ([9494c8e](https://github.com/prototypdigital/bluetemberg/commit/9494c8e96a4b3942fa394c529ef29594c144fbc9))

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
