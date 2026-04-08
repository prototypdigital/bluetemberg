# Why Bluetemberg

## The problem it solves

Most teams who adopt AI coding assistants end up with the same drift problem: rules get written once, committed to one platform's config folder, and then silently fall out of sync as the team grows. Someone adds a Cursor rule that never makes it to Claude. A new developer sets up Copilot instructions that contradict what's in `.cursor/rules/`. Six months later nobody knows which version is correct, and the AI is giving inconsistent answers depending on which tool you're using.

Bluetemberg solves this with a single source of truth in `llm/` and a sync engine that generates platform-specific files from it. The drift problem becomes a CI check rather than a social problem.

## Rules are self-contained

Each rule file is a complete, standalone document. The AI reads it directly — there are no cross-references, no includes, no indirection. When the sync engine copies `llm/rules/coding-standards.md` to `.cursor/rules/coding-standards.mdc`, the AI gets the full content of that file. Nothing else needs to be loaded.

This is a deliberate design choice. Cross-file dependencies ("see also: rule-x.md") require the AI to chase references, which is unreliable across platforms and harder to debug. Self-contained rules are simpler, faster to read, and easier to reason about.

## Why files live in your repo

The `llm/` directory lives in your project's repository, not in a separate shared package. This is also intentional.

A shared external kit creates its own drift problem: the kit evolves, your project pins an old version, and you end up with stale rules that nobody updates because the update process is friction. Keeping rules in the repo means:

- **They're owned by the team using them.** A rule that doesn't fit your project can be deleted or modified without waiting for a package update.
- **They're visible in PRs.** When a rule changes, the diff shows up in your pull request like any other file.
- **They're versioned with your code.** The rules that were active when a bug was introduced are preserved in git history.

Bluetemberg's job is to give you the starting set of rules and keep the platform-specific files in sync. What you do with the rules after that is your call.

## The kickoff + maintain split

There are two distinct phases to AI tooling setup:

1. **Kickoff** — getting a sensible starting configuration into a new project quickly
2. **Maintenance** — keeping that configuration up to date and in sync as the project evolves

Bluetemberg handles both. `init` handles the kickoff: it asks a few questions, picks appropriate defaults for your team type, and generates everything. `sync` handles maintenance: one command regenerates all platform files from the source of truth, and `sync --check` in CI catches drift before it ships.

The alternative — writing platform-specific configs by hand, separately for each tool — means every change has to be made three times (Cursor, Claude, Copilot), and there's no automated way to verify they're consistent.

## What Bluetemberg does not do

- It does not evaluate or run your rules. It copies and transforms them.
- It does not require an internet connection at sync time.
- It does not lock you into any AI platform. The `llm/` files are plain Markdown. You can stop using Bluetemberg and the files remain useful.
- It does not tell you what rules to write. The starter templates are defaults, not requirements (except the universal guardrails, which are baseline behaviors every project needs).
