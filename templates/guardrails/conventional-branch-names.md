---
description: Enforce conventional branch names before creating a worktree
trigger: EnterWorktree
hook_type: PreToolUse
check:
  field: name
  not_empty: true
  not_matches: '^claude/'
message: 'EnterWorktree requires a conventional branch name. Call EnterWorktree again with name="type/description" (e.g. feat/my-feature). Ask the user what the branch should be called if unclear. Types: feat fix chore refactor docs test'
profiles:
  - frontend
  - backend
  - fullstack
  - devops
  - pure-infra
---

# Conventional Branch Names

Blocks AI tools from creating worktrees with auto-generated names (e.g. `claude/some-name`).
Requires a branch name in `type/description` format before the worktree is created.
