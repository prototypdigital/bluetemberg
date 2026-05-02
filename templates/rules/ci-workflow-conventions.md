---
description: Secure CI/CD workflows with minimal permissions, pinned actions, and OIDC authentication.
scope:
  - ".github/workflows/*.yml"
  - ".github/workflows/*.yaml"
  - ".gitlab-ci.yml"
  - ".circleci/config.yml"
---

# CI workflow conventions

Write CI/CD workflows that are secure, maintainable, and resistant to supply-chain attacks.

## Action and tool pinning

- Pin third-party GitHub Actions to a commit SHA, never a branch or tag: `uses: actions/checkout@a81bbbf8298c0fa03ea29cdc473d45769f953675` not `@v4`.
- Use `action-versions` tools to automate SHA pinning and updates.
- For self-hosted tools, pin to specific versions in lockfiles or checksums.
- Document why each action is used and when its version was last reviewed.

## Permissions and OIDC

- Declare minimal `permissions:` at workflow level; override at job level if needed.
- Example: a test job needs no permissions; a deploy job needs `contents: read`, `id-token: write`.
- Never use long-lived PATs or secrets as CI credentials; prefer OIDC tokens (`id-token: write`, `permissions: id-token: write`).
- Rotate deploy keys and service account credentials after every successful deploy.

## Secrets and environment

- Store secrets in the repository's Secrets settings; never commit `.env` files.
- Reference secrets as `${{ secrets.SECRET_NAME }}` in workflows; never log them.
- Use `||` to set defaults for optional variables, never hardcode values.
- Document which secrets each job requires; make it part of onboarding.

## Concurrency and retries

- Use `concurrency:` groups to prevent overlapping deploy jobs: `group: deploy-${{ github.ref }}`, `cancel-in-progress: true`.
- Limit job `timeout-minutes:` to prevent hanging; default to 30 minutes for tests, 10 for deploys.
- Use conditional job triggers: `if: github.ref == 'refs/heads/main'` for deploy steps.
- Retry flaky steps with `continue-on-error:` sparingly; fix the root cause instead.

## Logging and debugging

- Never log secrets; mask them with `::add-mask::`.
- Use `runner.debug` and `secrets.ACTIONS_STEP_DEBUG` to enable verbose output.
- Keep workflow logs concise; compress build artifacts to avoid storage costs.
- Archive test results and coverage reports for trend analysis.
