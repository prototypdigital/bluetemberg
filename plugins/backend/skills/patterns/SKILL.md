---
name: patterns
description: Apply reusable architecture and coding patterns from project standards when implementing features or reviewing structure.
profiles:
  - frontend
  - backend
  - fullstack
---

# patterns

Use this skill when implementing or reviewing feature structure, state placement, and code organization.

## Triggers

- New feature implementation that requires architectural decisions
- Code review where structure or state placement is in question
- Refactoring to align existing code with established patterns

## Required behavior

1. The agent MUST check existing patterns in the codebase before introducing new ones.
2. The agent MUST align decisions with established project conventions (folder structure, naming, module boundaries).
3. The agent MUST prefer composition over inheritance and small, focused modules over monolithic files.
4. The agent SHOULD link to relevant documentation rather than restating full policy.
5. The agent SHOULD suggest doc updates when pattern guidance is missing or ambiguous.

## When NOT to use

- Trivial changes (typo fixes, comment updates, single-line edits)
- Generated code or third-party vendored files
