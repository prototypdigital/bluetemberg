---
description: Keep operational runbooks and ADRs accurate and commit them alongside the changes they document.
scope:
  - "**/docs/**"
  - "**/runbooks/**"
  - "**/adr/**"
  - "**/decisions/**"
  - "**/ops/**"
---

# Runbook discipline

Operational runbooks and architecture decision records (ADRs) must stay in sync with the infrastructure they describe. A stale runbook is a liability in an incident.

## When a runbook update is required

Update the relevant runbook in the same commit (not a follow-up) when:

- A service port changes (firewall rules, load balancer config, dependent services)
- A volume is renamed or its path changes (backup procedures, restore steps)
- An image is upgraded with breaking API changes (rollback procedure changes)
- A service is renamed, removed, or decomposed
- A secret or credential is rotated or its reference changes
- A dependency changes (new database, cache, external API)

## Required runbook content

Every runbook must document:

1. **Purpose** — what this service/component does and why.
2. **Start / stop / restart** — exact commands, including any required env vars or order dependencies.
3. **Health check** — how to verify the service is running correctly.
4. **Rollback** — step-by-step instructions to revert the most recent change.
5. **Known issues** — recurring problems and their resolution.

## ADRs

- Open an ADR for any architectural decision that is non-obvious, has significant blast radius, or was made under constraints.
- ADRs are immutable once accepted; if a decision is reversed, open a new ADR that supersedes the old one.
- Link from the relevant infra config (e.g., a comment in `docker-compose.yml`) to the ADR that explains why.

## Anti-patterns

- Do not commit infrastructure changes with "TODO: update runbook later."
- Do not put runbook content only in PR descriptions or Slack threads — it will not be found during an incident.
