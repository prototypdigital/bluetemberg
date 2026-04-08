---
name: security-audit
description: Run a security audit checklist against code changes for secrets, injection, and dependency risks.
---

# security-audit

Use this skill when reviewing code for security concerns or before deploying to production.

## Triggers

- Pre-release or pre-deploy review
- New authentication or authorization code
- Code that handles user input, file uploads, or external data

## Required behavior

1. The agent MUST check for hardcoded secrets, tokens, and credentials.
2. The agent MUST verify all user input is validated and sanitized before use.
3. The agent MUST flag direct SQL string interpolation or unparameterized queries.
4. The agent SHOULD check dependency versions against known CVE databases.
5. The agent SHOULD verify that error responses do not leak internal details.

## When NOT to use

- Pure UI/styling changes with no data handling
- Documentation-only changes
