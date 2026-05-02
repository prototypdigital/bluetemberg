---
name: rollback-plan
description: Require an explicit rollback plan for every infrastructure or deployment change before merge.
---

# rollback-plan

Use this skill when reviewing infrastructure, deployment, or database changes that affect production systems. Every change must have a tested rollback path.

## Triggers

- Changes to deployment manifests (Kubernetes, Docker Compose, Helm values)
- Ansible playbooks targeting production inventory
- Terraform changes to production workspaces
- Database schema migrations
- Dependency or image version bumps in production config
- CI/CD pipeline changes affecting production deploys

## Required behavior

1. **Define rollback steps:** Every PR must include explicit rollback instructions in the description or a linked runbook. Vague ("revert the commit") is not enough.
2. **Verify rollback is tested:** For stateful changes (schema migrations, volume changes), the rollback must have been tested in a staging environment.
3. **Check for data loss risk:** If rolling back would lose data (e.g., a column drop already ran), flag the change as requiring a data backup before applying.
4. **Time-to-rollback estimate:** Include an estimated time to execute the rollback. If it exceeds 15 minutes, require a pre-change backup or canary deploy.
5. **Rollback freeze window:** Flag if the change is in scope of an upcoming release freeze or maintenance window.

## Rollback plan format

Include this block in the PR description for every production change:

```markdown
## Rollback plan

**Steps:**
1. [Step-by-step instructions]

**Time estimate:** [N minutes]

**Data loss risk:** [None / Low (describe) / High (backup required)]

**Tested in staging:** [Yes / No — explain]
```

## When NOT to use

- Local development or sandbox environments
- Documentation-only changes
- Additive-only changes with no existing state at risk (new service, new namespace)
