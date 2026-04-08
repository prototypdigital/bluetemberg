---
name: docs-upkeep
description: Keep canonical docs aligned with implementation and workflow changes.
---

# docs-upkeep

Use this skill when code or workflow changes affect documented behavior.

## Triggers

- Code change that affects documented behavior
- New feature that needs documentation
- Workflow or configuration change

## Required behavior

1. The agent MUST update affected docs in the same task as the code change.
2. The agent MUST keep docs concise and link-based.
3. The agent SHOULD mention doc changes in handoff summaries.
