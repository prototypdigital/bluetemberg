---
name: workspace-hygiene
description: Keep workspace state clean, predictable, and review-friendly during edits.
---

# workspace-hygiene

Use this skill to maintain clean workspace state during editing sessions.

## Triggers

- Before committing changes
- After large refactoring operations
- When workspace state feels inconsistent

## Required behavior

1. The agent MUST run linting and formatting after code changes.
2. The agent MUST verify no unintended files were modified.
3. The agent SHOULD keep commits focused and atomic.
