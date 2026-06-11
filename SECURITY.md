# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.x     | ✅        |

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report vulnerabilities privately via GitHub Security Advisories:

👉 [Report a vulnerability](https://github.com/prototypdigital/bluetemberg/security/advisories/new)

We will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

## Threat model

bluetemberg generates AI tool configuration and writes auto-executing hooks into user projects (`.claude/settings.json`, `.cursor/rules/`, `.github/instructions/`). The primary attack surface is:

- **Pack supply chain** — malicious content in third-party packs installed via `bluetemberg add`
- **Guardrail hooks** — commands written into `.claude/settings.json` that execute automatically
- **Path traversal** — pack names/versions used as filesystem paths

If you discover a vulnerability in any of these areas, responsible disclosure is especially appreciated.
