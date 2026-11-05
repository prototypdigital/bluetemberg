# Changelog

## [0.20.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.19.0...bluetemberg-v0.20.0) (2026-11-05)


### Features

* **cli:** bluetemberg scan runs the content scan on local pack dirs ([d7d190c](https://github.com/prototypdigital/bluetemberg/commit/d7d190c00b99edb25147fbd5b466b6ec07395be7))
* **drafts:** draft skills and agents, not just rules (create-loop phase 2b) ([8451940](https://github.com/prototypdigital/bluetemberg/commit/84519406777eb2b85a5f6afcef1421f881c0cecb))
* **drafts:** draft skills and agents, not just rules (create-loop phase 2b) ([d902964](https://github.com/prototypdigital/bluetemberg/commit/d90296444a73bc8a713ce26ff8ba57587a5403cd)), closes [#197](https://github.com/prototypdigital/bluetemberg/issues/197)
* **drafts:** human-gated create-loop phase 1 (draft brief/new/check/promote) ([89f8827](https://github.com/prototypdigital/bluetemberg/commit/89f88274340cca065ceb4b043c2bc604f97b3766))
* **drafts:** human-gated create-loop phase 1 (draft brief/new/check/promote) ([fe2fbad](https://github.com/prototypdigital/bluetemberg/commit/fe2fbada79fe95ca08a92fbe5100bf97396ae582)), closes [#197](https://github.com/prototypdigital/bluetemberg/issues/197)
* **drafts:** prepare a packs contribution branch from a promoted draft (create-loop phase 3) ([401bf01](https://github.com/prototypdigital/bluetemberg/commit/401bf015a9a8e5c5300b329c5a690f535889a1eb))
* **drafts:** prepare a packs contribution branch from a promoted draft (create-loop phase 3) ([7e2c88f](https://github.com/prototypdigital/bluetemberg/commit/7e2c88ff91fccff210e56e17852e2e3bcfdedd96)), closes [#197](https://github.com/prototypdigital/bluetemberg/issues/197)
* **drafts:** verify citations against their pages (create-loop phase 2) ([810629e](https://github.com/prototypdigital/bluetemberg/commit/810629ead21cd94b4c97b83274c15d227961ed58))
* **drafts:** verify citations against their pages (create-loop phase 2) ([bb9cbeb](https://github.com/prototypdigital/bluetemberg/commit/bb9cbeb5b103adc999c786c4f71baacafa4646de)), closes [#197](https://github.com/prototypdigital/bluetemberg/issues/197)
* **managed-settings:** generate org policy files for Claude Code and Copilot ([13538e0](https://github.com/prototypdigital/bluetemberg/commit/13538e006e57a5e3bb923faaf35b60628af8d21b))
* **managed-settings:** generate org policy files for Claude Code and Copilot ([a04a586](https://github.com/prototypdigital/bluetemberg/commit/a04a5860566d30df2297d481442492d7f8124961)), closes [#287](https://github.com/prototypdigital/bluetemberg/issues/287)
* **managed-settings:** opt-in OTel telemetry export with pack attribution ([b122d26](https://github.com/prototypdigital/bluetemberg/commit/b122d262b1feaa0e097755ff7ddea36c36b9aaef))
* **managed-settings:** opt-in OTel telemetry export with pack attribution ([5992ea2](https://github.com/prototypdigital/bluetemberg/commit/5992ea2014feccfc08ab93dded13069fe2014659))
* **security:** capability report on install/update and shadowing warnings ([2c9666c](https://github.com/prototypdigital/bluetemberg/commit/2c9666c36146d0b15112997248d4d0a8c2a2556e))
* **security:** capability report on install/update and shadowing warnings ([68b74de](https://github.com/prototypdigital/bluetemberg/commit/68b74de90cb02b76bce8768eecf4f59bdc81cfeb))
* **security:** scan external sources and close scanner exfiltration gaps ([8024bd9](https://github.com/prototypdigital/bluetemberg/commit/8024bd929dbe26c4c798adbf1c2347ece46261d8))
* **security:** scan external sources and close scanner exfiltration gaps ([d770612](https://github.com/prototypdigital/bluetemberg/commit/d770612ffc8560564b6ecafc356b2283c165231d))
* **stacks:** resolve stack versions from pnpm and yarn lockfiles ([d46e50b](https://github.com/prototypdigital/bluetemberg/commit/d46e50b740df94632acb7b0f4efd349146250e9f))
* **stacks:** resolve stack versions from pnpm and yarn lockfiles ([038e7d8](https://github.com/prototypdigital/bluetemberg/commit/038e7d81a85f315d2408930b8736b6d2d378941d)), closes [#291](https://github.com/prototypdigital/bluetemberg/issues/291)


### Bug Fixes

* **catalog:** refresh snapshot to packs main for the 0.20.0 release ([d26d158](https://github.com/prototypdigital/bluetemberg/commit/d26d158ad6c5720bd181c6bc3d2eb958818311e2))
* **catalog:** refresh snapshot to packs main for the 0.20.0 release ([a97389d](https://github.com/prototypdigital/bluetemberg/commit/a97389d1efe6328599b263cc680d7a270cd667a1))
* **drafts:** close review-gate and grounding gaps from the adversarial review ([db4c961](https://github.com/prototypdigital/bluetemberg/commit/db4c961efcfda9761ddd084f71d5a0c4865ee494)), closes [#197](https://github.com/prototypdigital/bluetemberg/issues/197)
* **drafts:** draft pr runs none of the packs repo's code ([0532527](https://github.com/prototypdigital/bluetemberg/commit/0532527f9af7b0f5d611475644677d41a84223d0)), closes [#197](https://github.com/prototypdigital/bluetemberg/issues/197)
* **drafts:** harden citation verification from the adversarial review ([59b4b79](https://github.com/prototypdigital/bluetemberg/commit/59b4b795e391af1714e9bcc8e25933cf7a2c6285)), closes [#197](https://github.com/prototypdigital/bluetemberg/issues/197)
* **drafts:** promoted agents keep their tools on Claude Code ([4cd42f0](https://github.com/prototypdigital/bluetemberg/commit/4cd42f04c391a27a753332af45d052636bf3d2b7)), closes [#197](https://github.com/prototypdigital/bluetemberg/issues/197)
* **frontmatter:** harden frontmatter parsing and pack content scan ([d9a5d08](https://github.com/prototypdigital/bluetemberg/commit/d9a5d088b184532f82b27965943f686dbdfb4cb8))
* **frontmatter:** harden frontmatter parsing and pack content scan ([bc98937](https://github.com/prototypdigital/bluetemberg/commit/bc9893708f281e308777b76266d56714ea16eeea))
* **guardrails:** fail closed on malformed hook payloads, with an adversarial corpus ([29b5b45](https://github.com/prototypdigital/bluetemberg/commit/29b5b453a2f0484d30f059e87fd19996333605a9))
* **guardrails:** fail closed on malformed hook payloads, with an adversarial corpus ([f8d1e55](https://github.com/prototypdigital/bluetemberg/commit/f8d1e558a747601258c597fb0b5652d02fa59f0b))
* **guardrails:** read false as "false" and tighten self-review gaps ([03fe349](https://github.com/prototypdigital/bluetemberg/commit/03fe34952692b415b7814a97e9d60eec588ceced))
* **managed-settings:** allow .mcp.json servers and warn on unbundled packs ([48a6239](https://github.com/prototypdigital/bluetemberg/commit/48a62399366da733a0a4176fe23abd816cacd782))
* **managed-settings:** harden telemetry endpoint and attribute checks ([3e0b1f7](https://github.com/prototypdigital/bluetemberg/commit/3e0b1f7da10ee4aa311c6a0e992a6e13db169744))
* **managed-settings:** refuse unsafe --out targets and per-host plugin mismatches ([4a9df54](https://github.com/prototypdigital/bluetemberg/commit/4a9df547e8c91781b712af901ef22fcdaee5c984))
* **security:** capability report reads what sync uses and diffs full content ([e5984ea](https://github.com/prototypdigital/bluetemberg/commit/e5984ea0cdf0cfb37b8f2f7f698b0812c7a84c21))
* **security:** close self-review bypasses and false positives in the scanner ([8284836](https://github.com/prototypdigital/bluetemberg/commit/8284836c428306b886b980a5fa78a0bb3fcb1bcb))
* **security:** read guardrail frontmatter through the YAML-only parser in the capability report ([0a2c304](https://github.com/prototypdigital/bluetemberg/commit/0a2c304a96c228160e8a14f412e2e15953ec784a))
* **stacks:** match yarn's resolution rules and never report another package's version ([707f3b1](https://github.com/prototypdigital/bluetemberg/commit/707f3b1f548cb913ca5db29d9d2e46356f8dad2e))
* **stacks:** reuse parsed lockfiles across detections and prefer range-specific resolutions ([7461413](https://github.com/prototypdigital/bluetemberg/commit/7461413bf9c1514d42054feaf09ff224ec5a2468))

## [0.19.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.18.0...bluetemberg-v0.19.0) (2026-11-03)


### Features

* **catalog:** route pack content by platform ([6d717c1](https://github.com/prototypdigital/bluetemberg/commit/6d717c195c16d3ab3963da6f732553aa13ac5be6))
* **catalog:** route pack content by platform ([01dbdb5](https://github.com/prototypdigital/bluetemberg/commit/01dbdb5f1711d97874b09425b2ec4cd124e73b90)), closes [#281](https://github.com/prototypdigital/bluetemberg/issues/281)
* **stacks:** read the stack-to-package map from the catalog ([fce3b75](https://github.com/prototypdigital/bluetemberg/commit/fce3b7505c771856454a6d615773dd285622d74f))
* **stacks:** read the stack-to-package map from the catalog ([aa4cba4](https://github.com/prototypdigital/bluetemberg/commit/aa4cba44b8f92f3cfe0917aed8dc85f4f15c1adc)), closes [#290](https://github.com/prototypdigital/bluetemberg/issues/290)
* **sync:** consolidate skills output and stamp pack metadata ([03646aa](https://github.com/prototypdigital/bluetemberg/commit/03646aa8a8ec9849229864fff6d10387d4044564))
* **sync:** consolidate skills output and stamp pack metadata ([d7f749a](https://github.com/prototypdigital/bluetemberg/commit/d7f749ac723ffbee96eb852a3a3b65cd52539e31)), closes [#285](https://github.com/prototypdigital/bluetemberg/issues/285)
* **sync:** emit Agent Plugins 1.0 bundles as an opt-in agent-plugins platform ([efb7877](https://github.com/prototypdigital/bluetemberg/commit/efb7877f84e1211e55ff6fd67f1fbe20dc8b2a6b))
* **sync:** emit Agent Plugins 1.0 bundles as an opt-in agent-plugins platform ([d95c055](https://github.com/prototypdigital/bluetemberg/commit/d95c0551cc6e95c2253a3faaeb5db98a3e43f491)), closes [#283](https://github.com/prototypdigital/bluetemberg/issues/283)
* **sync:** scope extends entries to platforms ([3cd7e79](https://github.com/prototypdigital/bluetemberg/commit/3cd7e7933a1f5a7e31ca61fbfabaea07c840a812))
* **sync:** scope extends entries to platforms ([d6ce3ff](https://github.com/prototypdigital/bluetemberg/commit/d6ce3ff930186506e515139798b945112b43720d)), closes [#207](https://github.com/prototypdigital/bluetemberg/issues/207)


### Bug Fixes

* **catalog:** keep unknown catalog platform ids quiet and switch-profile config-tolerant ([94f78d9](https://github.com/prototypdigital/bluetemberg/commit/94f78d915fe6357558c21db6450901a29e06d1f7))
* **stacks:** harden the catalog stack map against review findings ([821a50d](https://github.com/prototypdigital/bluetemberg/commit/821a50df8ca1179e1df0b01bc4476cc767883145))
* **stacks:** share the stack map across monorepo packages and tighten detection ([f81aa81](https://github.com/prototypdigital/bluetemberg/commit/f81aa814d6f35aa6aaac0317245512584d334f2a))
* **sync:** align skipped-platform reports and guardrail hosts across sync and why ([a4d5fec](https://github.com/prototypdigital/bluetemberg/commit/a4d5fec10529eea50023aa9ba9442dd74f7a61aa))
* **sync:** count Copilot agents in agent-plugins bundles ([83dadbe](https://github.com/prototypdigital/bluetemberg/commit/83dadbef2997239436d64a07bb97115ca98b6160))
* **sync:** dedupe per-view messages, keep extends labels and coverage scope-aware ([1374a95](https://github.com/prototypdigital/bluetemberg/commit/1374a95c15d839a21f4f6cd5aae7a4b2d5d61fa7))
* **sync:** group platforms per content kind so unrelated scopes do not split shared outputs ([ff097f2](https://github.com/prototypdigital/bluetemberg/commit/ff097f2b3db9fd3ec9a858dab7138bcb5821b27d))
* **sync:** label extends entries by their config index ([3bbc5e9](https://github.com/prototypdigital/bluetemberg/commit/3bbc5e96893dd19100cd21a53c7c6c020efd2829))
* **why:** explain the copy each platform syncs under scoped extends ([8820988](https://github.com/prototypdigital/bluetemberg/commit/88209882691015efac489266a4d707182aa0e89a))

## [0.18.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.17.0...bluetemberg-v0.18.0) (2026-11-03)


### Features

* **registry:** scan pack content for unsafe patterns before install ([7bb2237](https://github.com/prototypdigital/bluetemberg/commit/7bb2237a52c8a55c514e8a8db85f70fe5cdf446b))
* **registry:** scan pack content for unsafe patterns before install ([51d4c1f](https://github.com/prototypdigital/bluetemberg/commit/51d4c1fc6377f12f104d93d1a9275976e7b238c6)), closes [#41](https://github.com/prototypdigital/bluetemberg/issues/41)


### Bug Fixes

* **guardrails:** keep Cursor from silently dropping .cursor/hooks.json ([64bd8bf](https://github.com/prototypdigital/bluetemberg/commit/64bd8bf4204575f404a4611fde4d5124a19bda6e))
* **guardrails:** keep Cursor from silently dropping .cursor/hooks.json ([3b92c6b](https://github.com/prototypdigital/bluetemberg/commit/3b92c6bd550ae1abd0518270ed2ffecbad762999))
* **registry:** close bypasses from second scanner review ([9f8dba5](https://github.com/prototypdigital/bluetemberg/commit/9f8dba5a949328579ac459f56afa5c93f19a21c5))
* **registry:** close scanner bypasses found in self-review ([6b16f7f](https://github.com/prototypdigital/bluetemberg/commit/6b16f7ffd831a57aa0540c0512c3693390f03e5f))
* **registry:** remove ambiguous separator from imperative lead-in regex ([400ba9c](https://github.com/prototypdigital/bluetemberg/commit/400ba9c5a02155d553ad7cd6b9fcbef76d6a8f35))
* **registry:** treat every HTML comment delimiter as a clause boundary ([a8a7dd7](https://github.com/prototypdigital/bluetemberg/commit/a8a7dd7606e63f52067bb14cb90777aaf18e2716))

## [0.17.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.16.0...bluetemberg-v0.17.0) (2026-10-30)


### Features

* **cli:** add bluetemberg eject to keep generated files and drop bluetemberg ([8c3a948](https://github.com/prototypdigital/bluetemberg/commit/8c3a9481730516ee8c4df950e698e985a7996c8f)), closes [#288](https://github.com/prototypdigital/bluetemberg/issues/288)
* **stacks:** add `why` to explain inclusion and diff stack upgrades ([fb0daa1](https://github.com/prototypdigital/bluetemberg/commit/fb0daa1b8bbc56111f14c57f265d2660d2f5e2e0)), closes [#293](https://github.com/prototypdigital/bluetemberg/issues/293)
* **stacks:** add range lifecycle lint and list-by-range query ([53ad3dc](https://github.com/prototypdigital/bluetemberg/commit/53ad3dc690ab54448ecd91c25e8ecc8f23134031)), closes [#294](https://github.com/prototypdigital/bluetemberg/issues/294)
* **sync:** migrate commands and prompt files to skills ([756479c](https://github.com/prototypdigital/bluetemberg/commit/756479cca29fd7f382994c8d3df56807af201e73))


### Bug Fixes

* **eject:** keep dry runs inside the copy and strip only emitted banners ([b2021dd](https://github.com/prototypdigital/bluetemberg/commit/b2021ddd914c8f3a9c3d593fca37a4a191b86442))
* **stacks:** match list queries like sync and harden the latest-version cache ([934bb8a](https://github.com/prototypdigital/bluetemberg/commit/934bb8a1fd37d64690e60d6929da8be8e3b79c5f))
* **stacks:** route `why` to the monorepo package sync uses and flag unknown --diff stacks ([5b94940](https://github.com/prototypdigital/bluetemberg/commit/5b94940ea497d8cd947c4fbab910d61e70e3411d))
* **sync:** keep migrated commands user-only on Codex and Devin ([43d9941](https://github.com/prototypdigital/bluetemberg/commit/43d9941f40f078cfa1551415f01b00864a8dddad))

## [0.16.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.15.0...bluetemberg-v0.16.0) (2026-10-30)


### Features

* **cli:** add bluetemberg uninstall ([f473388](https://github.com/prototypdigital/bluetemberg/commit/f473388dfa46dbae0407207ccfec81fbe33428a0))
* **guardrails:** compile Bash guardrails to Codex hooks ([2fc9bd9](https://github.com/prototypdigital/bluetemberg/commit/2fc9bd97265637e0868564a57a9051e81f0a5170))
* **guardrails:** compile Bash guardrails to Cursor hooks ([cb1b1a9](https://github.com/prototypdigital/bluetemberg/commit/cb1b1a969c51daab1139804a691883891e1386c6))
* **guardrails:** compile Bash guardrails to Devin Desktop hooks ([bb2ec84](https://github.com/prototypdigital/bluetemberg/commit/bb2ec84b01490f7fbeb2e1740734f132b890ac53))
* **guardrails:** compile Bash guardrails to GitHub Copilot hooks ([00e5d51](https://github.com/prototypdigital/bluetemberg/commit/00e5d510c86e2dc98c038df765b10cebadd0fa48))


### Bug Fixes

* **guardrails:** block Copilot payloads with no tool_name instead of skipping them ([64530f4](https://github.com/prototypdigital/bluetemberg/commit/64530f452c1a992c4f8963684ce874cea08a35e7))
* **guardrails:** close Codex Windows, field and worktree gaps ([50f4bdb](https://github.com/prototypdigital/bluetemberg/commit/50f4bdb50e4e9c7bf028823951365358e503b611))
* **guardrails:** read the field as jq data, only under tool_input, and fail closed ([25a2b10](https://github.com/prototypdigital/bluetemberg/commit/25a2b10fbbc82ab1a8080511d29d9694ed14dac2))
* **guardrails:** read the field from tool_input and send the block message to stderr ([ee69585](https://github.com/prototypdigital/bluetemberg/commit/ee695854af33df1613e87a5d0a17c2a69a836af5))
* **guardrails:** reject a non-list platforms field instead of aborting sync ([c94c5be](https://github.com/prototypdigital/bluetemberg/commit/c94c5be72111db65c491bccf7b0f9e6bada0465d))
* **guardrails:** stop Cursor guardrail hooks blocking passing calls ([e1d01de](https://github.com/prototypdigital/bluetemberg/commit/e1d01decde05609600b9c7d552f1f7db7c1a7250))

## [0.15.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.14.1...bluetemberg-v0.15.0) (2026-10-29)


### Features

* **init:** offer every catalog pack and gate stack-specific defaults on detected stacks ([c18af03](https://github.com/prototypdigital/bluetemberg/commit/c18af03d0ed3e850383a1e2d84673fb5c6a73d79)), closes [#273](https://github.com/prototypdigital/bluetemberg/issues/273)
* **sync:** point Gemini CLI at AGENTS.md and add the antigravity platform ([03c6669](https://github.com/prototypdigital/bluetemberg/commit/03c66698aaf29d440ec1ad67a87b0a4e58b1fda4)), closes [#276](https://github.com/prototypdigital/bluetemberg/issues/276)
* **sync:** retarget Windsurf to Devin Desktop, keep windsurf as an alias ([a37f6c5](https://github.com/prototypdigital/bluetemberg/commit/a37f6c55a352e9ccd2b8904e724253305693a49f)), closes [#277](https://github.com/prototypdigital/bluetemberg/issues/277)
* **sync:** track Antigravity MCP servers in llm/mcp-managed.json ([22cc675](https://github.com/prototypdigital/bluetemberg/commit/22cc675ca7cbb5149e95717d19218ea1057a82f5))


### Bug Fixes

* **cli:** warn that the ignored --rules flag is deprecated ([f586f4b](https://github.com/prototypdigital/bluetemberg/commit/f586f4b7ff72a0ddb847c57b66fa53189ba424f6))
* **sync:** address CodeQL and CodeRabbit findings on the Devin target ([a954b00](https://github.com/prototypdigital/bluetemberg/commit/a954b00cd33211fb776c6cb370fd61a837579d90))
* **sync:** address self-review findings on the .mcp.json merge ([2e24981](https://github.com/prototypdigital/bluetemberg/commit/2e24981b1d9de9f8ea416a9cf497c7fd8cb19765))
* **sync:** harden Devin target resolution and prune from review ([6a0680e](https://github.com/prototypdigital/bluetemberg/commit/6a0680e370d78b7e4e65b53a61d58481d0349302))
* **sync:** merge MCP servers into the root .mcp.json ([912997c](https://github.com/prototypdigital/bluetemberg/commit/912997c13efc45e157d5ea437a95625370407fe8)), closes [#271](https://github.com/prototypdigital/bluetemberg/issues/271)
* **sync:** prune stale GEMINI.md for antigravity and report mcp.json errors once ([b5d0e0e](https://github.com/prototypdigital/bluetemberg/commit/b5d0e0e07041c52455033a939c84903484fba42e))

## [0.14.1](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.14.0...bluetemberg-v0.14.1) (2026-10-29)


### Bug Fixes

* **deps:** refresh the lockfile, raise the MCP SDK and smol-toml floors, audit in CI ([314fd33](https://github.com/prototypdigital/bluetemberg/commit/314fd33b5a9bb831e39cf4f07d6452680a722a45))
* **docs:** show the init command that works headlessly ([19e024f](https://github.com/prototypdigital/bluetemberg/commit/19e024fa6b7707378afd7d4dbca8d9c4bc97ce1d)), closes [#272](https://github.com/prototypdigital/bluetemberg/issues/272)
* **sync:** write extraKnownMarketplaces in Claude Code's object form ([8d4f68a](https://github.com/prototypdigital/bluetemberg/commit/8d4f68a1ce4573e54cd040b77178d68805c044a3))

## [0.14.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.13.1...bluetemberg-v0.14.0) (2026-10-23)


### Features

* **sync:** copy a skill's supporting files, not just SKILL.md ([60d0b7a](https://github.com/prototypdigital/bluetemberg/commit/60d0b7a97a9cbf9e185c100fda714fc5bb0b589c))
* **sync:** put the generated-file banner on every output that can carry one ([b68edb8](https://github.com/prototypdigital/bluetemberg/commit/b68edb85b2afdc9bf144017efcafad3df8a1657b)), closes [#274](https://github.com/prototypdigital/bluetemberg/issues/274)


### Bug Fixes

* **cli:** rough edges from the end-to-end test ([4eb6a6b](https://github.com/prototypdigital/bluetemberg/commit/4eb6a6b21f78608d6b5596ffab63506329828d24)), closes [#289](https://github.com/prototypdigital/bluetemberg/issues/289)
* **init:** never overwrite files bluetemberg does not own ([fde8c7c](https://github.com/prototypdigital/bluetemberg/commit/fde8c7cf93747074756afffc902a53220dd71b0c)), closes [#209](https://github.com/prototypdigital/bluetemberg/issues/209)
* **sync:** flag stale outputs in --check, prune only generated files, drop orphaned guardrail hooks ([9bcb092](https://github.com/prototypdigital/bluetemberg/commit/9bcb09212a4fa08be9a7b217ddb464f47adbb2ce))
* **sync:** report stale outputs in --check, prune only generated files, drop orphaned guardrail hooks ([60d60e3](https://github.com/prototypdigital/bluetemberg/commit/60d60e30a2afffd690a5702b9b1a25590d22ff4d)), closes [#274](https://github.com/prototypdigital/bluetemberg/issues/274)

## [0.13.1](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.13.0...bluetemberg-v0.13.1) (2026-10-01)


### Bug Fixes

* **init:** don't fold legacy manifests into packages.json when pinning ranges ([19be7d7](https://github.com/prototypdigital/bluetemberg/commit/19be7d724746d1d55eb7d7b2fd9e4607bb0fd97c))
* **init:** write resolvable pack ranges instead of a fixed ^0.1.0 ([5ec56e8](https://github.com/prototypdigital/bluetemberg/commit/5ec56e862ae45fcdd008a0ecb385713bace46d3b)), closes [#268](https://github.com/prototypdigital/bluetemberg/issues/268)
* **sync:** apply stack gating to the Codex rules block and agents ([41578ee](https://github.com/prototypdigital/bluetemberg/commit/41578eee27646118c02145329e58215a717dddbc)), closes [#270](https://github.com/prototypdigital/bluetemberg/issues/270)
* **sync:** map abstract agent tools to Claude Code tool names ([6aa25d7](https://github.com/prototypdigital/bluetemberg/commit/6aa25d7a67e75a872b484d2e1dddd571d899d87f))

## [0.13.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.12.1...bluetemberg-v0.13.0) (2026-09-30)


### ⚠ BREAKING CHANGES

* **init:** init answers files that set the removed github keys have them ignored; projects wanting sync --check or marketplace publishing in CI add those steps to a workflow they own.
* **sync:** the banner changes the bytes of every generated rule/agent/skill/command, so the first `sync --check` after upgrading reports drift for all of them. Run `bluetemberg sync` once and commit. Projects that gitignore their generated output have nothing to do.

### Features

* **init:** stop scaffolding CI/CD workflows ([8504d1e](https://github.com/prototypdigital/bluetemberg/commit/8504d1e0efedc691b69acb00d41256cf5a5fc43f))
* **sync:** mark generated rules/agents/skills/commands as generated ([282c247](https://github.com/prototypdigital/bluetemberg/commit/282c2478cb2c58f0d82dacada767d90572b1afd9))
* **sync:** warn when CLAUDE.md hides AGENTS.md from Claude Code ([8b4c4de](https://github.com/prototypdigital/bluetemberg/commit/8b4c4dee92fc9c220e77bef9fc45664beead2cc5)), closes [#260](https://github.com/prototypdigital/bluetemberg/issues/260)


### Bug Fixes

* **hooks:** scope PR reviewer's read access to the PR being reviewed ([f817fb0](https://github.com/prototypdigital/bluetemberg/commit/f817fb08f9c56b1192090057c22524ead25b549a))
* **stacks:** close the remaining silent mis-gates from the [#212](https://github.com/prototypdigital/bluetemberg/issues/212) register ([394ba0f](https://github.com/prototypdigital/bluetemberg/commit/394ba0f2a0a1539bbede1d0337e32b88d0602a2b))
* **stacks:** let a range that names a prerelease match its own version ([a49bf11](https://github.com/prototypdigital/bluetemberg/commit/a49bf115021ffe8d7896b0baba7e427826478a1c))
* **stacks:** make coverage version-aware instead of a name-level boolean ([bdf5a10](https://github.com/prototypdigital/bluetemberg/commit/bdf5a10035d2380984d5bfe53f61a2a8c020cddb))
* **stacks:** scope catalog profiles/stacks to the owning pack's files ([ee46672](https://github.com/prototypdigital/bluetemberg/commit/ee46672e8d13b064ccae7a47193904391d75a11c)), closes [#249](https://github.com/prototypdigital/bluetemberg/issues/249)
* **sync:** don't crash the AGENTS.md import check on directory [@tokens](https://github.com/tokens) ([39ba721](https://github.com/prototypdigital/bluetemberg/commit/39ba7211a9e6848dde823e2e3801cf263e2fd9ca))
* **sync:** make sync --check truly read-only ([90943d6](https://github.com/prototypdigital/bluetemberg/commit/90943d66c05fa83d0e85ecb017c7bb2969248937)), closes [#242](https://github.com/prototypdigital/bluetemberg/issues/242)

## [0.12.1](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.12.0...bluetemberg-v0.12.1) (2026-08-27)


### Bug Fixes

* **guardrails:** fail closed when a condition regex is not valid ERE ([1506301](https://github.com/prototypdigital/bluetemberg/commit/15063014741cf84731d683b711cd61630c42d2e4))
* **sync:** pair managed-block markers instead of taking the first of each ([effdc47](https://github.com/prototypdigital/bluetemberg/commit/effdc47fbbbe1b8e4c9528dfc4452ac553fdd574)), closes [#241](https://github.com/prototypdigital/bluetemberg/issues/241)
* **sync:** reject managed-block markers in generated content ([66f09ec](https://github.com/prototypdigital/bluetemberg/commit/66f09ec010daf4447b4d3cba165eb4975e8dd86b))

## [0.12.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.11.0...bluetemberg-v0.12.0) (2026-08-27)


### Features

* **sync:** recursive monorepo sync keyed off discovered configs ([5ca6b51](https://github.com/prototypdigital/bluetemberg/commit/5ca6b51962ba699121b85a7aa64c531028ce5b29))

## [0.11.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.10.1...bluetemberg-v0.11.0) (2026-08-27)


### Features

* **registry:** private pack distribution — auth, install-side unsigned opt-in, source tokens ([f4d86d8](https://github.com/prototypdigital/bluetemberg/commit/f4d86d8044708cb90ef40714016727e0c0228c3b))
* **registry:** support private pack distribution ([fcc27f0](https://github.com/prototypdigital/bluetemberg/commit/fcc27f02b9d9c10126b3ba7f51cb577007c3959a))


### Bug Fixes

* **ci:** skip commitlint for dependabot prs ([688ced1](https://github.com/prototypdigital/bluetemberg/commit/688ced12c65f013b6525b7ac6da70da52fb819dd))
* **ci:** skip commitlint for dependabot PRs ([652a733](https://github.com/prototypdigital/bluetemberg/commit/652a73363dd682b623a00155c6e42b0602a16d0f))
* **registry:** scope credentials to affirmed hosts, stabilise source archives ([dd91a98](https://github.com/prototypdigital/bluetemberg/commit/dd91a985138281bd70870672aea5fab75d486833))
* **registry:** warn on skipped signatures, re-check tarball transport, gate .npmrc ignore ([b1c07b3](https://github.com/prototypdigital/bluetemberg/commit/b1c07b39cb3f657bdb365502cd1ebb020b9cfa45))

## [0.10.1](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.10.0...bluetemberg-v0.10.1) (2026-08-25)


### Bug Fixes

* list Prototyp Digital under contributors, not maintainer twice ([ef2b6dc](https://github.com/prototypdigital/bluetemberg/commit/ef2b6dc025c7a4d3152d99a976b27a6f180fe48f))

## [0.10.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.9.0...bluetemberg-v0.10.0) (2026-08-08)


### Features

* **hooks:** automatic session audit on SessionEnd ([c3f5d5e](https://github.com/prototypdigital/bluetemberg/commit/c3f5d5e1ad9760b1006b6c399222914ac406cd19))
* **hooks:** automatic session audit on SessionEnd + hooks.claude.json migration ([9765456](https://github.com/prototypdigital/bluetemberg/commit/97654566c4752f53981421bebbbece1a23ed863d))


### Bug Fixes

* **hooks:** address CodeRabbit findings on PR [#231](https://github.com/prototypdigital/bluetemberg/issues/231) ([20d71d3](https://github.com/prototypdigital/bluetemberg/commit/20d71d35f314069639f430000dbfc1fcd51c6164))

## [0.9.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.8.1...bluetemberg-v0.9.0) (2026-08-08)


### Features

* **hooks:** spawn background PR reviewer when an agent opens a PR ([1e67699](https://github.com/prototypdigital/bluetemberg/commit/1e676991d137f26ac2c3477f6d7470d7e42e658c))
* **hooks:** wire spawn-pr-review into PostToolUse Bash hook ([144ed74](https://github.com/prototypdigital/bluetemberg/commit/144ed7481a6a3574953c23964f53633fb44623a2))
* **sync:** sync Claude Code hooks from llm/hooks.claude.json ([38ae582](https://github.com/prototypdigital/bluetemberg/commit/38ae582cf59213c6bb5665c40fc43c4490ce4753)), closes [#225](https://github.com/prototypdigital/bluetemberg/issues/225)


### Bug Fixes

* **hooks:** address dogfood review findings on spawn-pr-review ([65939c9](https://github.com/prototypdigital/bluetemberg/commit/65939c95a460eb9574c157d4817f9156eeb3a6c7))
* **hooks:** enforce comment-only reviews structurally via posting wrapper ([a81b04a](https://github.com/prototypdigital/bluetemberg/commit/a81b04a21f17aa90f9165d2bf718d601e6d2c4cf))

## [0.8.1](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.8.0...bluetemberg-v0.8.1) (2026-07-30)


### Bug Fixes

* **marketplace:** emit required owner field in marketplace.json ([aa43f89](https://github.com/prototypdigital/bluetemberg/commit/aa43f893a2802c6d6350aa14cc002a2f511b8969))

## [0.8.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.7.0...bluetemberg-v0.8.0) (2026-07-30)


### Features

* **mcp:** extend bluetemberg_org_histogram to support remote scanning ([0187617](https://github.com/prototypdigital/bluetemberg/commit/0187617a4e8172a8b7a9c39ff3445eec2be05005))
* **stacks:** --since &lt;days&gt; filters scan-org to recently active repos ([6e746bf](https://github.com/prototypdigital/bluetemberg/commit/6e746bf09cbce809999dfbc7c67e2b9dbcd3a66a))
* **stacks:** m6 — org-repo (stack,version) scanner and coverage histogram ([c250551](https://github.com/prototypdigital/bluetemberg/commit/c250551095aa9ee3b74ea588d453f6d7507ac9cc))
* **stacks:** M6 — org-repo (stack,version) scanner and coverage histogram ([d371d9f](https://github.com/prototypdigital/bluetemberg/commit/d371d9f492996f634b5b48c6b5fd77646be74b38))
* **stacks:** scan-org remote scanning via the GitHub API ([ea9f7ee](https://github.com/prototypdigital/bluetemberg/commit/ea9f7ee8070f4ace1ca7d01e14009f5e37b069ad))
* **sync:** make stack version filtering audible ([38a195a](https://github.com/prototypdigital/bluetemberg/commit/38a195adbae5d57f05ee96c81245d8f0dc4c201b))


### Bug Fixes

* **marketplace:** conform generated output to Claude Code's plugin schema ([6075a03](https://github.com/prototypdigital/bluetemberg/commit/6075a030ecb5bcac915e440808ac499c539e5170))
* **stacks:** address review findings in M6 scan-org ([74d11de](https://github.com/prototypdigital/bluetemberg/commit/74d11de056c0e842007412b53d34aac70e4f40a8))
* **sync:** align guardrail output format and checkMode behaviour with rules ([89f3638](https://github.com/prototypdigital/bluetemberg/commit/89f3638df914ca038a9999646feb68abadc343de))

## [0.7.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.6.0...bluetemberg-v0.7.0) (2026-06-16)


### Features

* **add:** accept multiple package arguments in a single call ([01d0e97](https://github.com/prototypdigital/bluetemberg/commit/01d0e97d625140cee24eb449abe11b8ee4fef2d5)), closes [#137](https://github.com/prototypdigital/bluetemberg/issues/137)
* **site:** add evidence-backed "standards with receipts" section ([e3ab92a](https://github.com/prototypdigital/bluetemberg/commit/e3ab92a1515bc9df0faba62e358e35cca31df0c6))
* **site:** refresh landing copy — six tools, version-aware routing, signatures, evidence-backed ([b69d88c](https://github.com/prototypdigital/bluetemberg/commit/b69d88c04f2320197975be24dc9ef4ad7327c963))
* **site:** refresh landing copy for stacks, MCP, signatures, Codex ([fc613b0](https://github.com/prototypdigital/bluetemberg/commit/fc613b0baa171d3d2e521db0b88f4319e9e939ec))
* **sync:** monorepo config inheritance with per-package overrides ([00eac4b](https://github.com/prototypdigital/bluetemberg/commit/00eac4b8da0d3b42162d5094003216c5b109e059))
* **sync:** surface per-file diff under `sync --check --diff` ([14d2eec](https://github.com/prototypdigital/bluetemberg/commit/14d2eec4d327abdc27d7c68e6f1f0f7e4856837d))
* **sync:** surface per-file diff under sync --check --diff ([fe6b6e4](https://github.com/prototypdigital/bluetemberg/commit/fe6b6e4b2cc5702517e9d9596a91daafc71f6dbb))


### Bug Fixes

* **add:** drop dead --version flag, dedupe packs, summarize failures ([e18d970](https://github.com/prototypdigital/bluetemberg/commit/e18d97029aed9f758b4805e38e5c6399850f655f))
* **ci:** skip prepublishOnly in publish job ([c0b2689](https://github.com/prototypdigital/bluetemberg/commit/c0b2689407282e699de5a18f37be5d3b7ee382e2))
* **ci:** skip prepublishOnly in publish job — dist already built by artifact ([29c4930](https://github.com/prototypdigital/bluetemberg/commit/29c4930035d8309d6a1a3dca3cc2e1134a240789))
* **cli:** guard against subcommand options shadowed by global flags ([6c6fa85](https://github.com/prototypdigital/bluetemberg/commit/6c6fa8586671ce6e29697562759c88f9caf912c1))
* **site:** match the install profile picker to the real init wizard ([916e44b](https://github.com/prototypdigital/bluetemberg/commit/916e44bfbcdb6f3e9bbb9b13d38086a90c265116))
* **sync:** address code review findings on --diff renderer ([7faf9ee](https://github.com/prototypdigital/bluetemberg/commit/7faf9ee11be11b3795029fde25e1586ac10d185c))

## [0.6.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.5.0...bluetemberg-v0.6.0) (2026-06-15)


### Features

* register Design Engineer profile ([bf76173](https://github.com/prototypdigital/bluetemberg/commit/bf7617368d1b041b0cf079b1d4db95dbe4bf3132))
* register Design Engineer profile (engine half of packs[#40](https://github.com/prototypdigital/bluetemberg/issues/40)) ([f7d80c2](https://github.com/prototypdigital/bluetemberg/commit/f7d80c271e470e2313b6f74d628900650858daac))
* **registry:** verify npm ECDSA registry signatures + add verify command ([4a8a41f](https://github.com/prototypdigital/bluetemberg/commit/4a8a41ffbbf8aab25eacc93bd0cb5e79fe167ced))
* **site:** add Bluetemberg logo and wire it into the site ([e2d1451](https://github.com/prototypdigital/bluetemberg/commit/e2d14519642dc65cf284fb214d27b1bab0c13ad9))
* **stacks:** activate version-aware gating at sync + detect/coverage CLI ([0ae1645](https://github.com/prototypdigital/bluetemberg/commit/0ae1645f46003e69dab10d8ba0e2d088bc9d189d))
* **stacks:** first-party MCP server (bluetemberg mcp serve) ([cba3f92](https://github.com/prototypdigital/bluetemberg/commit/cba3f928810f8cdcd1981a4677b4018f3c72af5c))
* **stacks:** init wizard detect-then-confirm stack step ([228f63a](https://github.com/prototypdigital/bluetemberg/commit/228f63a80e347e00dcfca96ab342f45a741ab059))
* **stacks:** version-aware technology axis — M0–M5 engine foundation ([3e89ef6](https://github.com/prototypdigital/bluetemberg/commit/3e89ef6b106ab6d812daaa1a81ddda1bc42c9232))
* **stacks:** version-aware technology axis (M0–M5 foundation) ([58ea378](https://github.com/prototypdigital/bluetemberg/commit/58ea37804a9912a55824877e01b77c07619a57db))
* **sync:** add OpenAI Codex as a sync target ([ca19a6a](https://github.com/prototypdigital/bluetemberg/commit/ca19a6a6976ab2b159e39ec6c77a35f2a9b02114)), closes [#175](https://github.com/prototypdigital/bluetemberg/issues/175)


### Bug Fixes

* **catalog:** normalize catalog item arrays to string ids ([ae41526](https://github.com/prototypdigital/bluetemberg/commit/ae415264fb818a145e62035c37ccc51e74622c76))
* **catalog:** reject malformed items instead of coercing to empty-string ids ([3cdec18](https://github.com/prototypdigital/bluetemberg/commit/3cdec184e1c1182cb4004222ec94b7813bac1fd5))
* **codex:** guard ensureDir in check mode, surface MCP parse errors, extract helpers ([09f27fd](https://github.com/prototypdigital/bluetemberg/commit/09f27fd8bd27ff51a675f34f763bbe82c954112a))
* **registry:** address CodeRabbit review findings ([8a5365b](https://github.com/prototypdigital/bluetemberg/commit/8a5365b75a17930253b0eb4a2cb30468e11ac335))
* **registry:** harden checkPackIntegrity for signed entries ([3489a3a](https://github.com/prototypdigital/bluetemberg/commit/3489a3a8653e733240b8165ac395bfa812ee45cc))
* **registry:** remove unused VerifyStatus import ([0363bdd](https://github.com/prototypdigital/bluetemberg/commit/0363bdd7552f9765f11cd3d7454e6bb7a7a38b79))
* **site:** align supply chain label column and clarify comparison heading ([2043348](https://github.com/prototypdigital/bluetemberg/commit/2043348f945e60eae17b37aabe0e9dea642d52c6))
* **stacks:** address CodeRabbit — clear stale guardrail hooks, inject report logger ([75f73f4](https://github.com/prototypdigital/bluetemberg/commit/75f73f414dd8009f9a5fcc4b251f5542e8df61d7))
* **stacks:** address review — auto sentinel, gap semantics, malformed frontmatter ([8a3a112](https://github.com/prototypdigital/bluetemberg/commit/8a3a112271c05bf8a6ea69815c321ebca69573c8))
* **stacks:** harden --stacks parsing and gate the empty wizard step ([011f4c1](https://github.com/prototypdigital/bluetemberg/commit/011f4c1d5245a58256039f4a4dc71e04d0ca429b))

## [0.5.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.4.0...bluetemberg-v0.5.0) (2026-06-14)


### Features

* **presets:** derive pack ids and profiles from the catalog (single source) ([b821b86](https://github.com/prototypdigital/bluetemberg/commit/b821b86092a9752467f227e749f3425ad7872494))
* **site:** add humans + agents section — the dual-audience story ([becf9d5](https://github.com/prototypdigital/bluetemberg/commit/becf9d5f26f62dd1d407ba076fe8b44bf8320822))
* **site:** holistic mobile layout — replace tables with native mobile components ([ed6eb5e](https://github.com/prototypdigital/bluetemberg/commit/ed6eb5ee6e75bae12439225dbc9730643646dffe))
* **site:** rewrite landing pitch around verified differentiators ([953d5e9](https://github.com/prototypdigital/bluetemberg/commit/953d5e9736b0d6d8002bf2cf1e11da784d7e6f1a))
* **site:** show profile picker as faux terminal below install command ([2284eac](https://github.com/prototypdigital/bluetemberg/commit/2284eacec82242038483395ccbf946b6c11b5d5b))
* **site:** static GitHub Pages landing page ([48fc821](https://github.com/prototypdigital/bluetemberg/commit/48fc821b177b45ca0ffa0d895a1bde51dda9d1d4))
* **site:** transpose platform matrix and drop verbose footnote ([2ed3a52](https://github.com/prototypdigital/bluetemberg/commit/2ed3a52bf3d3b5ede0ce58f36fb8486477d0d2d9))


### Bug Fixes

* add agentic to INIT_TEAM_PROFILES so headless and config paths accept it ([7f50b8c](https://github.com/prototypdigital/bluetemberg/commit/7f50b8c64fe5a7a8598f35540d42f2f36a7cf8c9)), closes [#172](https://github.com/prototypdigital/bluetemberg/issues/172)
* address CodeRabbit review findings ([e9fc699](https://github.com/prototypdigital/bluetemberg/commit/e9fc699478dfa1aa95a78537bb29b2a591460b9c))
* **catalog:** address CodeRabbit review findings ([3af6bea](https://github.com/prototypdigital/bluetemberg/commit/3af6bea7ce97d667bae0446dadcbccc5d9691590))
* **catalog:** eliminate redundant catalog load and fix dev snapshot gap ([25ae3f6](https://github.com/prototypdigital/bluetemberg/commit/25ae3f6b540f62296ca0f7d83325895a13821d26))
* **ci:** add catalog schema guard and build-missing error for check-overlays ([19cfc2c](https://github.com/prototypdigital/bluetemberg/commit/19cfc2cde131bfd24ae645b4f5bfb6e76175d24d))
* **init:** add agentic to INIT_TEAM_PROFILES ([7c56c60](https://github.com/prototypdigital/bluetemberg/commit/7c56c608329062659edf8b3f63def0bac049173c))
* **init:** align rule-collection rule ids with actual pack files ([806509c](https://github.com/prototypdigital/bluetemberg/commit/806509c092057dd58f4750f699d5cecdeb40a773))
* **init:** replace 5-tag arrays with universal:true ([#152](https://github.com/prototypdigital/bluetemberg/issues/152)) ([423cec5](https://github.com/prototypdigital/bluetemberg/commit/423cec50b8562aa4c2142a7bf75cc9360a12c0f2))
* **init:** replace 5-tag arrays with universal:true for docs-maintainer, docs-upkeep, workspace-hygiene ([7fc8d43](https://github.com/prototypdigital/bluetemberg/commit/7fc8d43ece87162e4fe5dac8f0d7cbba0ac54d9b)), closes [#152](https://github.com/prototypdigital/bluetemberg/issues/152)
* **marketplace:** distinguish absent profiles key from explicit empty override ([5f1784e](https://github.com/prototypdigital/bluetemberg/commit/5f1784e974ce6de32289f2baccd958f3fdf368a5))
* **presets:** filter overlays with no catalog match instead of emitting empty metadata ([8eb4449](https://github.com/prototypdigital/bluetemberg/commit/8eb44492b635022759fde52c1aab756f25040ba8))
* **security:** remove ReDoS in normalizePath + refresh SECURITY.md ([faafad9](https://github.com/prototypdigital/bluetemberg/commit/faafad985f6f6bed4282dc5f2bf9ecdbb870efb7))
* **security:** remove ReDoS in normalizePath; refresh SECURITY.md ([27c0126](https://github.com/prototypdigital/bluetemberg/commit/27c01266ff53c30357561e7d8fbd156cee98c1d9))
* **site:** consistent emphasis + code styling in security section ([6f113cf](https://github.com/prototypdigital/bluetemberg/commit/6f113cf9bdc98c5fd76449451e8e477aff1b0a91))

## [0.4.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.3.0...bluetemberg-v0.4.0) (2026-06-13)


### Features

* agentic profile, shared/universal presets, dry-run install, e2e CI ([fa62f27](https://github.com/prototypdigital/bluetemberg/commit/fa62f27124ea0be6f93b63dda25589bcd5f44f0a))
* **cli:** add `bluetemberg preview <profile>` command ([57e4048](https://github.com/prototypdigital/bluetemberg/commit/57e4048f66005e342c2986efec760de454c2e1c9)), closes [#146](https://github.com/prototypdigital/bluetemberg/issues/146)
* **github:** scaffold community health files and PR quality workflows ([c75bef9](https://github.com/prototypdigital/bluetemberg/commit/c75bef95995fbc1102aa61ef371318b2c8dbb8c1))
* **init:** add CodeRabbit AI PR review to GitHub scaffolding ([e4703f4](https://github.com/prototypdigital/bluetemberg/commit/e4703f462d8e8d4f839ee54f6a631d9afa0c8dac))
* **init:** scaffold GitHub open-source best-practice files ([1a741b7](https://github.com/prototypdigital/bluetemberg/commit/1a741b78f26cc20f7aaf059b8de99681d413d84e))
* **init:** wire agentic profile to its pack family in presets ([1ee20de](https://github.com/prototypdigital/bluetemberg/commit/1ee20de09bc0492567a5115356ba4a73e1d8202e))
* security hardening, agentic profile, shared presets, dry-run, preview command, e2e CI ([9c49a08](https://github.com/prototypdigital/bluetemberg/commit/9c49a08be854d2ea8c6f6dd26281a6aa26189323))


### Bug Fixes

* address all CodeRabbit review issues from PR [#156](https://github.com/prototypdigital/bluetemberg/issues/156) ([f387fd7](https://github.com/prototypdigital/bluetemberg/commit/f387fd78c90d1cb2c0c56e1d7511bbdca736584b))
* address CodeRabbit review findings on PR [#150](https://github.com/prototypdigital/bluetemberg/issues/150) ([f0a5126](https://github.com/prototypdigital/bluetemberg/commit/f0a512614ae280d9b179a9f264890b2cdf212044))
* **ci:** add NODE_AUTH_TOKEN to publish step ([543640f](https://github.com/prototypdigital/bluetemberg/commit/543640fcc916a1af1f53184b05fa76138f6ac011))
* **github:** add customization placeholders for LICENSE and CODE_OF_CONDUCT ([9e11cc6](https://github.com/prototypdigital/bluetemberg/commit/9e11cc687efe6b5856c2ad761a506b15425a5f89))
* **init:** bump scaffolded GitHub Actions to current major versions ([4a3e0c0](https://github.com/prototypdigital/bluetemberg/commit/4a3e0c0dfa625f199b38224bc310e7e66d00801e))
* **init:** correct CodeRabbit app URL and add install instructions ([3092f69](https://github.com/prototypdigital/bluetemberg/commit/3092f693cef3ddcdc267d6b58ba45aa75d690ad6))
* **init:** validate github config field types in assertInitAnswers ([ea07e3d](https://github.com/prototypdigital/bluetemberg/commit/ea07e3d0131ef4d91852f39bd8f870bb10368dab))
* **registry:** per-pack install isolation and tarball host pinning ([ebeca30](https://github.com/prototypdigital/bluetemberg/commit/ebeca30ad7521b71f86c477f4315fbaa9c1c8f96))

## [0.3.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.10...bluetemberg-v0.3.0) (2026-06-11)


### ⚠ BREAKING CHANGES

* the package is renamed from @prototypdigital/bluetemberg to bluetemberg and publishes to public npm instead of GitHub Packages. Update install and import references accordingly.

### Features

* **guardrails:** install guardrails as packs, sync from all sources ([6e93f25](https://github.com/prototypdigital/bluetemberg/commit/6e93f25e13c0922bfb04a6823f7ec59cafca3cdb))
* **init,sources:** add source commands to --help --json and external sources to init wizard ([af17f5a](https://github.com/prototypdigital/bluetemberg/commit/af17f5a4c58715ee2bf00907f63fde2c07e450a0))
* **init:** add empty-scaffold rule source for bring-your-own rules ([c5538e4](https://github.com/prototypdigital/bluetemberg/commit/c5538e496bd399442cfe1ef2622835499c03a61e))
* **init:** empty-scaffold rule source (bring your own rules) ([f72e12b](https://github.com/prototypdigital/bluetemberg/commit/f72e12be352dd6b9ba558126da3f92cd5490ab8d))
* **init:** retire bundled rule templates in favour of registry packs ([f339c5a](https://github.com/prototypdigital/bluetemberg/commit/f339c5ad723415a8b872839c9cb76cb614a0bbc9))
* publish to public npm as unscoped "bluetemberg" (MIT) ([cf514d1](https://github.com/prototypdigital/bluetemberg/commit/cf514d1d57ce3db5caa4cfeda775a6b8429540e3))
* **sources:** add cursor.directory adapter (metadata + GitHub delegation) ([4eb477c](https://github.com/prototypdigital/bluetemberg/commit/4eb477ce06683c922ad6cb3504076bc1aa50a364)), closes [#45](https://github.com/prototypdigital/bluetemberg/issues/45)
* **sources:** add PRPM adapter ([8ce96e0](https://github.com/prototypdigital/bluetemberg/commit/8ce96e0fea9984df99a36c1955ee9b0af2ef87d9)), closes [#45](https://github.com/prototypdigital/bluetemberg/issues/45)
* **sources:** pluggable external rule source framework + GitHub adapter ([562943b](https://github.com/prototypdigital/bluetemberg/commit/562943b008bc9426bf3ede79f5def26cddc8aeb2)), closes [#45](https://github.com/prototypdigital/bluetemberg/issues/45)
* **sources:** warn on cursor-directory use + resilient search ([bf1e031](https://github.com/prototypdigital/bluetemberg/commit/bf1e031ba6b6873265b8f293e9f5047eabf8eceb))


### Bug Fixes

* address review findings from PR [#118](https://github.com/prototypdigital/bluetemberg/issues/118) ([5cfa209](https://github.com/prototypdigital/bluetemberg/commit/5cfa209267348a3978df2400c6bd9ab6a5b66187))
* **cli:** declare --check and --dry-run as distinct sync options ([5df7613](https://github.com/prototypdigital/bluetemberg/commit/5df761344629fb4d15b9d70a41498fb3fb6058af))
* **deps:** require Node &gt;=20 to match commander 14 ([4664f35](https://github.com/prototypdigital/bluetemberg/commit/4664f356be478b7c641d4acbe4024428b2f82e14))
* **deps:** resolve npm audit security vulnerabilities ([22456ec](https://github.com/prototypdigital/bluetemberg/commit/22456ec8ce877e1ce77574bbe1f205362b73d756)), closes [#103](https://github.com/prototypdigital/bluetemberg/issues/103)
* **init:** add pure-infra tags to git/security/docs collections; update docs ([d3163c9](https://github.com/prototypdigital/bluetemberg/commit/d3163c947e0475c4e8dfa5bb523be8e238c78874))
* **init:** persist empty llm/rules/ via .gitkeep for none rule source ([0c4d4ef](https://github.com/prototypdigital/bluetemberg/commit/0c4d4ef8cd330f0478ca14ed860e11565e5db307))
* **marketplace:** error on unknown profiles and empty plugin bundles ([dc95c34](https://github.com/prototypdigital/bluetemberg/commit/dc95c342ecebc277fb78c34c9d50ba20f8d99dbc)), closes [#88](https://github.com/prototypdigital/bluetemberg/issues/88)
* **marketplace:** skip empty plugin manifests and sort valid-profiles list ([22f5eae](https://github.com/prototypdigital/bluetemberg/commit/22f5eae307d8c66e8f50e3d0b2f4cd956e659a5a))
* **sources:** bake cursor.directory public credentials into constants ([a5d2171](https://github.com/prototypdigital/bluetemberg/commit/a5d2171433ffa3cb37bf461d79d5f7e5b10a5085))
* **sources:** harden 0.3.0 external-source framework + doc/lockfile parity ([ffa3209](https://github.com/prototypdigital/bluetemberg/commit/ffa32096478f85dd7df84ad4b52e424e831db349))
* **sources:** harden external fetch (integrity, size caps, input validation) ([f8a735c](https://github.com/prototypdigital/bluetemberg/commit/f8a735c06f606e1ffac1b87c83587fc9f72d30ba))
* **sources:** thread net options through the cursor.directory adapter ([5a7d78d](https://github.com/prototypdigital/bluetemberg/commit/5a7d78d6bc0c627f2ee695276127ae6a8170640b))
* **tests:** update cli.test.ts for removed rules field and collections source ([25c2c89](https://github.com/prototypdigital/bluetemberg/commit/25c2c8942d374f0d956e49da3b069689f5d3409c))

## [0.2.10](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.9...bluetemberg-v0.2.10) (2026-05-20)


### Features

* **guardrails:** add guardrails as a first-class vendor-neutral primitive ([59ce090](https://github.com/prototypdigital/bluetemberg/commit/59ce090ca6021e252a78aecac6ee5849c433c984))
* **init:** add profile field to config and switch-profile command ([579cc1b](https://github.com/prototypdigital/bluetemberg/commit/579cc1b42b1eb7ce295994adf58e1d0d95883214))
* **next:** add @prototypdigital/next rules pack ([4d30ae9](https://github.com/prototypdigital/bluetemberg/commit/4d30ae9d1688ed524ddbd88f168fbeda902c2f30))
* **next:** add @prototypdigital/next rules pack with NEXT_PUBLIC_* rule ([2aad3a0](https://github.com/prototypdigital/bluetemberg/commit/2aad3a0be616f0adc60580ffca27c48518a4f77a))


### Bug Fixes

* **switch-profile:** address code review issues ([0934471](https://github.com/prototypdigital/bluetemberg/commit/093447161862f9e5f516a0a69e8989e8429a3315))

## [0.2.9](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.8...bluetemberg-v0.2.9) (2026-05-15)


### Bug Fixes

* **init:** scaffold .claude/settings.json with EnterWorktree naming gate ([651aa93](https://github.com/prototypdigital/bluetemberg/commit/651aa93145f7aba34e9e96cfababc33b2fa026ff))

## [0.2.8](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.7...bluetemberg-v0.2.8) (2026-05-15)


### Features

* **skills:** add structured code-review skill ([ad8cbb3](https://github.com/prototypdigital/bluetemberg/commit/ad8cbb3b1a66de858b97260a98d197fd33f18260))
* **skills:** add structured code-review skill with intent-first, severity-tiered prompting ([8c924fb](https://github.com/prototypdigital/bluetemberg/commit/8c924fb6e24e5e591890389338d33aa573ba001b))


### Bug Fixes

* **skills:** correct code-review skill format and fact-check claims ([10946cf](https://github.com/prototypdigital/bluetemberg/commit/10946cfd61a53bf4a076135373f0397be832fd51))
* **skills:** remove external links from skill body — move to PR description ([6229dac](https://github.com/prototypdigital/bluetemberg/commit/6229dac9e51e2590db3ec4e57d6c0835921e795a))

## [0.2.7](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.6...bluetemberg-v0.2.7) (2026-05-09)


### Features

* **marketplace:** bundle rules into plugin packs with profile filtering ([730bd9d](https://github.com/prototypdigital/bluetemberg/commit/730bd9d2268e3de41f483bafa611fb88aa0fa90c))
* **windsurf:** add Windsurf as a sync target platform ([f468789](https://github.com/prototypdigital/bluetemberg/commit/f468789dc5f3bee46baa1c4bba5e4a7c3cfc5f3a))

## [0.2.6](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.5...bluetemberg-v0.2.6) (2026-05-08)


### Features

* add claude-marketplace platform emitter ([96fdc18](https://github.com/prototypdigital/bluetemberg/commit/96fdc187814e113da60633e50797dc4399ea7dda))
* implement profile filtering for marketplace plugins ([4a97f75](https://github.com/prototypdigital/bluetemberg/commit/4a97f75a71f66ee20d9f59a88ee71ee9749e12e7))
* **marketplace:** add hooks bundling and skill frontmatter pass-through ([d4dcab4](https://github.com/prototypdigital/bluetemberg/commit/d4dcab4f8742e7e4c1121c77aec744d0e2136de7))
* **marketplace:** add react-patterns to skill templates and SKILL_PRESETS ([0d8151d](https://github.com/prototypdigital/bluetemberg/commit/0d8151d9316847db95fdb6ac9fe841cb1918c1c5))
* **marketplace:** add remote repo sync, extraKnownMarketplaces, and CI workflow ([005aa89](https://github.com/prototypdigital/bluetemberg/commit/005aa8920a0513f6e7e0f04b4868b7372cb7912b))
* **marketplace:** dedicated repo sync, extraKnownMarketplaces, CI workflow ([6228e5d](https://github.com/prototypdigital/bluetemberg/commit/6228e5de90f522dd0107d87dd246f9ee85152ff5))
* **marketplace:** dogfood marketplace, profile skills/agents, extend init wizard ([76b648a](https://github.com/prototypdigital/bluetemberg/commit/76b648a7541c6d71c76048f1b3f65faecf03d306))
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
* **registry:** add official rule collection packages ([b92e1f7](https://github.com/prototypdigital/bluetemberg/commit/b92e1f729184eb577ee6d6dcd08cfff29b57009b))
* **rules:** add mermaid-diagrams rule template ([8fa6ab6](https://github.com/prototypdigital/bluetemberg/commit/8fa6ab6bb175dad877f9c1a6ebb6b3fbe9439ec7))


### Bug Fixes

* **registry:** address all PR review issues ([1103d4c](https://github.com/prototypdigital/bluetemberg/commit/1103d4c0f3e67d8f0ef1c8d6a9586229dcc28bfc))
* **registry:** prune stale lockfile entries in update command ([928f85c](https://github.com/prototypdigital/bluetemberg/commit/928f85c7fcedc60b140a4c75945336cba0147d69))
* **release:** remove unnecessary permissions block and pin app token action to v3 ([4429379](https://github.com/prototypdigital/bluetemberg/commit/44293794c8ded7c3bff48f360f9d919bb03b8c29))
* **release:** trigger CI and commitlint on bot-created PRs ([d21aa81](https://github.com/prototypdigital/bluetemberg/commit/d21aa817978844a9115e14e91855c24c8aede5f4))
* **release:** use GitHub App token in release-please to trigger CI ([19a03d5](https://github.com/prototypdigital/bluetemberg/commit/19a03d5af6d75f8ce3165e83410ae6419fe3e23f))

## [0.2.2](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.1...bluetemberg-v0.2.2) (2026-04-11)


### Features

* **registry:** add community rule registry with pack management ([fe213bb](https://github.com/prototypdigital/bluetemberg/commit/fe213bbcee27d7e706c9cb663969b4b808659ed5))


### Bug Fixes

* **registry:** address all PR [#37](https://github.com/prototypdigital/bluetemberg/issues/37) review issues ([db3ac12](https://github.com/prototypdigital/bluetemberg/commit/db3ac124f0054efd7ca83868581b1b6cb4495a79))
* **registry:** address security and correctness issues in pack management ([f72d404](https://github.com/prototypdigital/bluetemberg/commit/f72d40480c62c484da6c73939b3131d406cf7dfb))
* **registry:** tighten path traversal check and add prune summary to install log ([d8dd226](https://github.com/prototypdigital/bluetemberg/commit/d8dd2262648668897ea00fb038caf2cf9a1b73ec))

## [0.2.1](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.2.0...bluetemberg-v0.2.1) (2026-04-10)


### Features

* **platform:** add Gemini CLI as a supported target platform ([d8bb39f](https://github.com/prototypdigital/bluetemberg/commit/d8bb39f565669b15a58a057b5cde1fcd53d4501c))
* **sync:** add --verbose flag and SyncResults.warnings ([79fdeb0](https://github.com/prototypdigital/bluetemberg/commit/79fdeb0e961d4d94792179448b604ef3def9f6bd))
* **sync:** add --verbose flag and warnings to SyncResults ([4b93f07](https://github.com/prototypdigital/bluetemberg/commit/4b93f070b6f5c284ac83a9ed7fb1682416b5f5fa))
* **sync:** add extends field for merging shared/remote source directories ([a23af07](https://github.com/prototypdigital/bluetemberg/commit/a23af07f6eb32048ea9565a52497b21eb0b96dad))
* **sync:** add extends field for shared/remote source merging ([735ee2a](https://github.com/prototypdigital/bluetemberg/commit/735ee2a9624ff4467ada4d94cf11f1ec30a7aa19))


### Bug Fixes

* **pr-27:** graceful config errors, preserve adapters, fix skills dir, add tests ([6c94c89](https://github.com/prototypdigital/bluetemberg/commit/6c94c89ee6dc734c79e58665e854a0a1bf5c50bd))
* **rules:** add branch naming convention to git-workflow rule ([5fd0ec9](https://github.com/prototypdigital/bluetemberg/commit/5fd0ec9fc6ff51f8b642e98684828138b364c0f8))
* **scaffold:** add tier-2 tests and fix init bugs ([01ee4f9](https://github.com/prototypdigital/bluetemberg/commit/01ee4f92061843995c8ee250e48624e3ae583b3a))

## [0.2.0](https://github.com/prototypdigital/bluetemberg/compare/bluetemberg-v0.1.3...bluetemberg-v0.2.0) (2026-04-10)


### ⚠ BREAKING CHANGES

* **sync:** harden exit codes, targets validation, prune, check newlines
* Programmatic sync() returns a Promise; use await sync(root, options).

### Features

* async sync, adapter pipeline, and multi-platform extensions ([44409b4](https://github.com/prototypdigital/bluetemberg/commit/44409b4198007cda422467c2e33e84ec6d7d1a94))
* **sync:** add cursor default targets for agents and skills ([fe8112e](https://github.com/prototypdigital/bluetemberg/commit/fe8112e23c85513c07a66827a3c143e902fa6dd7))
* **sync:** harden exit codes, targets validation, prune, check newlines ([63695d1](https://github.com/prototypdigital/bluetemberg/commit/63695d14b271586ddbecd5e35d7937a117fa9d02))


### Bug Fixes

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

## Earlier changes (before release notes were automated)

These entries were written by hand before Release Please took over this file. The changes they describe shipped in 0.2.0.

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
