---
name: migration-safety
description: Review database migrations for safety, rollback capability, and zero-downtime compatibility.
---

# migration-safety

Use this skill when creating or reviewing database schema migrations.

## Triggers

- New migration file creation
- Schema change review
- Pre-deploy database change validation

## Required behavior

1. The agent MUST verify every migration has a corresponding rollback (down migration).
2. The agent MUST flag destructive operations (DROP, column removal) as requiring explicit approval.
3. The agent MUST check that migrations are compatible with zero-downtime deploys (no exclusive locks on hot tables).
4. The agent SHOULD prefer additive changes (add column with default) over destructive ones.
5. The agent SHOULD verify data migrations handle large tables with batching.

## When NOT to use

- Application code changes that don't modify schema
- Seed data or fixture updates
