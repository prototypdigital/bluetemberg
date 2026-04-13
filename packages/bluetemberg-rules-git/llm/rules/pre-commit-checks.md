---
description: Run formatter, linter, and build checks before every commit.
scope: "**"
---

# Pre-commit checks

Before committing any changes, verify the workspace is clean and CI-ready.

## Required steps

1. Run the project formatter on all modified files (e.g. `prettier --write`).
2. Run the linter and fix any new warnings introduced by the changes.
3. Verify the build passes (`tsc --noEmit`, `npm run build`, or equivalent).
4. Never commit files that have unresolved diagnostics, type errors, or lint failures.

## Scope

This applies to every commit — feature work, refactors, docs, config changes. No exceptions.
If a formatter or linter config exists in the project, respect it. If `.prettierignore` or `.eslintignore` excludes certain paths, do not force-format those paths.
