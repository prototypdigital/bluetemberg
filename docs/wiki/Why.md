# Why Bluetemberg

AI coding standards, shipped like a dependency: version-locked, integrity-verified, signed, and routed to the right engineer and the right stack version. Installed with one command.

## The problem it solves

A team's AI coding rules usually start as a file someone wrote once. Then they spread: copied into a second repo, edited there, pasted into a third. Six months later there are five versions, nobody knows which is current, and a rule written for Payload 2 is quietly steering an agent in a Payload 3 codebase. Nothing says which copy is right, nothing checks that a copy was not altered on the way in, and nothing stops the wrong one from loading.

That is a distribution problem, and the fix is the one every other kind of shared code already uses: publish the content as a versioned package, pin it, verify it on install, and let the consumer decide what applies to them.

## What you get

- **Versioning.** Rules, agents, skills and guardrails are npm packages. `llm/packages.json` holds semver ranges; `llm/packages-lock.json` holds the exact versions. `bluetemberg update` moves them on purpose, never by accident.
- **Integrity.** Every pack is checked against its SHA-512 hash on download, and the registry's ECDSA signature is verified against the registry's published keys. Tarballs are size-capped and path-traversal-filtered. The lockfile records the signing key id.
- **Routing by role.** A profile (frontend, backend, devops, …) preselects the packs that fit the role. Those are defaults, not bundles: add or remove anything.
- **Routing by stack version.** A rule tagged `stacks: { payload: '>=3 <4' }` is delivered only where the detected version satisfies it. This one is a hard exclusion, and sync lists every file it withheld so you can audit it.
- **Guardrails.** Declarative checks compiled into hooks the tool enforces, for the rules an assistant must not be able to skip.
- **Native output for every tool.** The same source lands as `.cursor/rules`, `.claude/rules`, `.github/instructions`, `AGENTS.md` and the rest, each in the format that tool reads. This is a capability, not the point: as tools converge on `AGENTS.md`, the format matters less and the guarantees above matter more.

## "But everything is converging on AGENTS.md."

Good. A shared file solves the format. It does not give you a version, a hash, a per-role selection, or a way to keep a Payload 2 rule out of a Payload 3 repo. Bluetemberg emits `AGENTS.md` too, and answers who gets which rules, at which version, and how you know the content was not tampered with in transit.

## What lands in your repo stays yours

Installed content is written into your repository as plain Markdown. You can read it, diff it in a pull request, and override any file by putting one with the same name under `llm/`. Local files always win over packs. If you stop using Bluetemberg, the files remain useful; nothing in them depends on the engine.

Rules are self-contained on purpose. Each file is a complete document the AI reads directly, with no cross-references to chase. That keeps them reliable across tools and easy to reason about.

External sources (`bluetemberg source add`) follow the same discipline: a community rule set is pinned to an exact version in a committed lockfile, translated into your tree, and loses to your local rules on a name clash. It is a way to seed content you then own, not a live dependency that can shift underneath you.

## Kickoff and maintenance

`init` is the kickoff: pick a profile and the tools you use, and it writes the config, the manifest, and the first set of files. `install` fetches and verifies the packs. `sync` is the maintenance loop: regenerate every tool's files from the source of truth, and in CI, `sync --check` fails the build when a generated file drifts from its source or outlives it.

## What Bluetemberg does not do

- It does not run or evaluate your rules. It distributes and transforms them.
- It does not touch your CI/CD pipeline. `init` scaffolds repository files such as Dependabot and templates, never workflows.
- It does not phone home. `sync` works offline; only `install`, `update` and `search` talk to the registry.
- It does not lock you in. The source and the output are Markdown you own.
- It does not decide what good rules are. The official packs are a starting point; replace any of them.
