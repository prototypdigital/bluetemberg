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

## [0.2.8](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.7...bluetemberg-v0.2.8) (2026-05-15)


### Features

* **skills:** add structured code-review skill ([ad8cbb3](https://github.com/prototypdigital/bluetemberg/commit/ad8cbb3b1a66de858b97260a98d197fd33f18260))
* **skills:** add structured code-review skill with intent-first, severity-tiered prompting ([8c924fb](https://github.com/prototypdigital/bluetemberg/commit/8c924fb6e24e5e591890389338d33aa573ba001b))


### Bug Fixes

* **skills:** correct code-review skill format and fact-check claims ([10946cf](https://github.com/prototypdigital/bluetemberg/commit/10946cfd61a53bf4a076135373f0397be832fd51))
* **skills:** remove external links from skill body — move to PR description ([6229dac](https://github.com/prototypdigital/bluetemberg/commit/6229dac9e51e2590db3ec4e57d6c0835921e795a))

## [0.2.7](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.6...bluetemberg-v0.2.7) (2026-05-09)


### Features

* **marketplace:** bundle rules into plugin packs with profile filtering ([469e1c4](https://github.com/prototypdigital/bluetemberg/commit/469e1c491b03ea87fa578e18aab224508d3bf516))
* **marketplace:** bundle rules into plugin packs with profile filtering ([730bd9d](https://github.com/prototypdigital/bluetemberg/commit/730bd9d2268e3de41f483bafa611fb88aa0fa90c))
* **windsurf:** add Windsurf as a sync target platform ([f9c7f68](https://github.com/prototypdigital/bluetemberg/commit/f9c7f68d2a61b5568bbad54ef71b530f3c023a90))
* **windsurf:** add Windsurf as a sync target platform ([f468789](https://github.com/prototypdigital/bluetemberg/commit/f468789dc5f3bee46baa1c4bba5e4a7c3cfc5f3a))

## [0.2.6](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.5...bluetemberg-v0.2.6) (2026-05-08)


### Features

* add claude-marketplace platform emitter ([8c6cefb](https://github.com/prototypdigital/bluetemberg/commit/8c6cefb0cbd87cb586997b00e954cebdc1d8eb7e))
* add claude-marketplace platform emitter ([96fdc18](https://github.com/prototypdigital/bluetemberg/commit/96fdc187814e113da60633e50797dc4399ea7dda))
* implement profile filtering for marketplace plugins ([4a97f75](https://github.com/prototypdigital/bluetemberg/commit/4a97f75a71f66ee20d9f59a88ee71ee9749e12e7))
* **marketplace:** add hooks bundling and skill frontmatter pass-through ([d4dcab4](https://github.com/prototypdigital/bluetemberg/commit/d4dcab4f8742e7e4c1121c77aec744d0e2136de7))
* **marketplace:** add react-patterns to skill templates and SKILL_PRESETS ([0d8151d](https://github.com/prototypdigital/bluetemberg/commit/0d8151d9316847db95fdb6ac9fe841cb1918c1c5))
* **marketplace:** add remote repo sync, extraKnownMarketplaces, and CI workflow ([005aa89](https://github.com/prototypdigital/bluetemberg/commit/005aa8920a0513f6e7e0f04b4868b7372cb7912b))
* **marketplace:** dedicated repo sync, extraKnownMarketplaces, CI workflow ([6228e5d](https://github.com/prototypdigital/bluetemberg/commit/6228e5de90f522dd0107d87dd246f9ee85152ff5))
* **marketplace:** dogfood marketplace, profile skills/agents, extend init wizard ([b2a3355](https://github.com/prototypdigital/bluetemberg/commit/b2a33559fcadf31cf20f0491b7b874f112f52726))
* **marketplace:** dogfood marketplace, profile skills/agents, extend init wizard ([76b648a](https://github.com/prototypdigital/bluetemberg/commit/76b648a7541c6d71c76048f1b3f65faecf03d306))
* **marketplace:** wire claude-marketplace into init, scaffold, prune, and docs ([101cf79](https://github.com/prototypdigital/bluetemberg/commit/101cf798416cedb06b089df8f0d30cc0a6f09831))
* **marketplace:** wire claude-marketplace into init, scaffold, prune, and docs ([5f5fa84](https://github.com/prototypdigital/bluetemberg/commit/5f5fa84f21767f5866ff4b334c92dec953b91731))
* resolve marketplace profile filtering from presets ([fc5d0db](https://github.com/prototypdigital/bluetemberg/commit/fc5d0dbf7717340de23daa18d33b2b433c4c840b))
* resolve profile filtering from presets for standard files ([7a7dfd2](https://github.com/prototypdigital/bluetemberg/commit/7a7dfd2de0e1331211af6c73419e95eb7fcb3fc9))


### Bug Fixes

* address review issues in claude-marketplace emitter ([5582695](https://github.com/prototypdigital/bluetemberg/commit/55826958281aed1684af5409e0dc3ee409d0148c))
* **marketplace:** address review findings from PR [#72](https://github.com/prototypdigital/bluetemberg/issues/72) ([dd6fd47](https://github.com/prototypdigital/bluetemberg/commit/dd6fd47a100303f02e1d8bc748ad90d466306d5f))
* **marketplace:** address review findings from PR [#73](https://github.com/prototypdigital/bluetemberg/issues/73) ([f5e994e](https://github.com/prototypdigital/bluetemberg/commit/f5e994ec5dae32b86c2d4028959c19321abe97b4))
* use resolveProfiles in catch blocks and add preset-resolution tests ([9174a74](https://github.com/prototypdigital/bluetemberg/commit/9174a745bb6ea5343eb8690ef0333f964caa21ee))

## [0.2.5](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.4...bluetemberg-v0.2.5) (2026-05-02)


### Features

* **init:** add --silent, shared catalog, and clearer config errors ([e277f35](https://github.com/prototypdigital/bluetemberg/commit/e277f35c0b4c020266df6d9b6a90efd501845a25))
* **init:** add --silent, shared catalog, and clearer config errors ([9a68e55](https://github.com/prototypdigital/bluetemberg/commit/9a68e555a0bbe6fedc37caab30d2756cc7bbe450))

## [0.2.4](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.3...bluetemberg-v0.2.4) (2026-05-02)


### Features

* **init:** non-interactive mode, JSON config, and machine-readable help ([cae1932](https://github.com/prototypdigital/bluetemberg/commit/cae19324f2e9e2257da4b98bf5372fd16742774d))
* **init:** non-interactive mode, JSON config, machine-readable help ([2cc543d](https://github.com/prototypdigital/bluetemberg/commit/2cc543de5efffcab077f53ec81c168c843d82f8e))

## [0.2.3](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.2...bluetemberg-v0.2.3) (2026-05-02)


### Features

* **devops:** add Ansible, container, CI workflow rules and specialist agent ([daa37f6](https://github.com/prototypdigital/bluetemberg/commit/daa37f6a73e9ecb9b110813dc717d1cc537da65e))
* **devops:** add K8s, Helm, idempotency rules, SRE/K8s agents, infra skills, pure-infra profile ([4a39f75](https://github.com/prototypdigital/bluetemberg/commit/4a39f754c01c17448281fe18ff7c83dee172a84a))
* **devops:** ansible/k8s/infra rules, agents, skills, and pure-infra profile ([1f037d5](https://github.com/prototypdigital/bluetemberg/commit/1f037d5807802636ab3340e9c863cb1f7b40e4e0))
* **registry:** add bluetemberg update command ([907c460](https://github.com/prototypdigital/bluetemberg/commit/907c46036ec144509d898fef91030db153b29dd8))
* **registry:** add official rule collection packages ([56eeb2e](https://github.com/prototypdigital/bluetemberg/commit/56eeb2e7c430e575265c8be0fab70aa465e0a018))
* **registry:** add official rule collection packages ([b92e1f7](https://github.com/prototypdigital/bluetemberg/commit/b92e1f729184eb577ee6d6dcd08cfff29b57009b))
* **rules:** add mermaid-diagrams rule template ([363e1da](https://github.com/prototypdigital/bluetemberg/commit/363e1da9ad9e9282d2aa57c970f59aa748a6f040))
* **rules:** add mermaid-diagrams rule template ([8fa6ab6](https://github.com/prototypdigital/bluetemberg/commit/8fa6ab6bb175dad877f9c1a6ebb6b3fbe9439ec7))


### Bug Fixes

* **registry:** address all PR review issues ([1103d4c](https://github.com/prototypdigital/bluetemberg/commit/1103d4c0f3e67d8f0ef1c8d6a9586229dcc28bfc))
* **registry:** prune stale lockfile entries in update command ([928f85c](https://github.com/prototypdigital/bluetemberg/commit/928f85c7fcedc60b140a4c75945336cba0147d69))
* **release:** remove unnecessary permissions block and pin app token action to v3 ([4429379](https://github.com/prototypdigital/bluetemberg/commit/44293794c8ded7c3bff48f360f9d919bb03b8c29))
* **release:** trigger CI and commitlint on bot-created PRs ([4364a60](https://github.com/prototypdigital/bluetemberg/commit/4364a60b01a028b25df6b5594932b119b2ed197e))
* **release:** trigger CI and commitlint on bot-created PRs ([d21aa81](https://github.com/prototypdigital/bluetemberg/commit/d21aa817978844a9115e14e91855c24c8aede5f4))
* **release:** use GitHub App token in release-please to trigger CI ([19a03d5](https://github.com/prototypdigital/bluetemberg/commit/19a03d5af6d75f8ce3165e83410ae6419fe3e23f))

## [0.2.2](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.1...bluetemberg-v0.2.2) (2026-04-11)


### Features

* **registry:** add community rule registry with pack management ([c38e9f2](https://github.com/prototypdigital/bluetemberg/commit/c38e9f28715215f7836ecc58fcfeabf34c52a58a))
* **registry:** add community rule registry with pack management ([fe213bb](https://github.com/prototypdigital/bluetemberg/commit/fe213bbcee27d7e706c9cb663969b4b808659ed5))


### Bug Fixes

* **registry:** address all PR [#37](https://github.com/prototypdigital/bluetemberg/issues/37) review issues ([db3ac12](https://github.com/prototypdigital/bluetemberg/commit/db3ac124f0054efd7ca83868581b1b6cb4495a79))
* **registry:** address security and correctness issues in pack management ([f72d404](https://github.com/prototypdigital/bluetemberg/commit/f72d40480c62c484da6c73939b3131d406cf7dfb))
* **registry:** tighten path traversal check and add prune summary to install log ([d8dd226](https://github.com/prototypdigital/bluetemberg/commit/d8dd2262648668897ea00fb038caf2cf9a1b73ec))

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
