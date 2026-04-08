---
name: ci-cd-best-practices
description: Optimize CI/CD pipeline configuration for speed, reliability, and caching.
---

# ci-cd-best-practices

Use this skill when creating or modifying CI/CD pipeline configuration.

## Triggers

- New or modified GitHub Actions, GitLab CI, or similar workflow files
- Build performance optimization
- Adding new jobs, steps, or deployment stages

## Required behavior

1. The agent MUST cache dependency installs (npm, pip, etc.) between runs.
2. The agent MUST pin action/image versions to SHAs or tags, never `latest`.
3. The agent MUST run lint, type-check, and tests before any deploy step.
4. The agent SHOULD parallelize independent jobs to reduce wall-clock time.
5. The agent SHOULD use path filters to skip irrelevant workflows on PRs.

## When NOT to use

- Application code changes that don't touch pipeline configs
- Local development tooling setup
