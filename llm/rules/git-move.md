---
description: Use git mv for tracked files to preserve history.
scope: "**"
---

# Git move

When renaming or moving files that are tracked by git, always use `git mv` instead of the filesystem move. This preserves file history and makes the rename visible in diffs.
