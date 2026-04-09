---
description: Branch protection and PR workflow rules — no direct pushes to main, PRs must be rebased on top of origin/main before raising.
scope: "**"
---

# Git workflow

## Branch protection

Never push commits directly to `main` or `master`. All changes must go through a pull request.

## Pull requests

- Always open PRs against `origin/main`.
- Before raising a PR, rebase the branch on top of the latest `origin/main`:
  ```
  git fetch origin
  git rebase origin/main
  ```
- Resolve any conflicts during the rebase before pushing.
- Force-push the rebased branch to update the remote: `git push --force-with-lease`.
