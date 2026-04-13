---
description: Keep documentation in sync with every user-facing change.
scope: "**"
---

# Docs parity

A PR that changes behavior without updating docs is not done.

## What counts as user-facing

- New or removed CLI flags, commands, or options
- Changes to the init wizard (new questions, removed choices, changed defaults)
- New or removed rule, agent, or skill templates
- Config schema changes (`bluetemberg.config.json`)
- Changes to sync behavior or platform output

## Required behavior

When any of the above change:

1. Update `README.md` if the change affects the install flow, wizard description, or sync table.
2. Update the relevant `docs/wiki/` page if one covers the changed area.
3. Include the doc update in the same commit as the code change — not a follow-up.

## When NOT required

- Internal refactors with no behavior change (renaming a variable, extracting a function)
- Test-only changes
- Dependency bumps with no API change
