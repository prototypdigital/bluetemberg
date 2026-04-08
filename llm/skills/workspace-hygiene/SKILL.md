---
name: workspace-hygiene
description: Keep workspace state clean, predictable, and review-friendly during editing sessions.
---

# workspace-hygiene

Use this skill to maintain clean workspace state during editing sessions and before commits.

## Triggers

- Before committing changes or creating a pull request
- After large refactoring or multi-file operations
- When workspace state feels inconsistent or has unintended changes

## Required behavior

1. The agent MUST run linting and formatting on all modified files after code changes.
2. The agent MUST verify no unintended files were modified (check `git diff` scope).
3. The agent MUST ensure the build passes and tests are green before considering work complete.
4. The agent SHOULD keep commits focused and atomic — one logical change per commit.
5. The agent SHOULD clean up temporary files, debug logging, and commented-out code before committing.

## When NOT to use

- Exploratory prototyping where polish is premature
- Work-in-progress branches explicitly marked as drafts
