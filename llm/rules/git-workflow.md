---
description: Branch protection, branch naming, and PR workflow rules — no direct pushes to main, branches must follow type/description convention, PRs must be rebased on top of origin/main before raising.
scope: "**"
---

# Git workflow

## Branch protection

Never push commits directly to `main` or `master`. All changes must go through a pull request.

## Branch naming

Branch names must follow the conventional commit type as a prefix:

```
type/short-description
```

Common types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`.

Examples:
- `feat/mcp-sync-support`
- `fix/scaffold-skills-dir`
- `chore/update-dependencies`
- `docs/contributing-guide`

Never push fixes or additions directly onto another open PR's branch. Always open a new branch and a new PR.

## Pull requests

- Always open PRs against `origin/main`.
- Before raising a PR, rebase the branch on top of the latest `origin/main`:
  ```
  git fetch origin
  git rebase origin/main
  ```
- Resolve any conflicts during the rebase before pushing.
- Force-push the rebased branch to update the remote: `git push --force-with-lease`.
- PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`.
