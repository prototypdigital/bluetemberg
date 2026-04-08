---
description: Never hardcode secrets, tokens, or credentials in source code.
scope: "**"
---

# Security — secrets management

Secrets, tokens, API keys, and connection strings must never appear in source code.

## Rules

- Read secrets from environment variables or a secrets manager at runtime.
- Never commit `.env` files, credentials JSON, or private keys.
- Use placeholder values in example configs (e.g. `YOUR_API_KEY_HERE`).
- Rotate any secret that was accidentally committed, even after removal.
- Keep `.env.example` with variable names but no real values.
- Flag hardcoded strings that look like tokens, passwords, or connection strings in code review.
