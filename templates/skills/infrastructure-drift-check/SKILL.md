---
name: infrastructure-drift-check
description: Verify that declared infrastructure state matches deployed state before merging IaC changes.
---

# infrastructure-drift-check

Use this skill before merging infrastructure-as-code changes to ensure the declared state is consistent with what is deployed.

## Triggers

- Changes to `*.tf` files (Terraform)
- Changes to Ansible playbooks or inventory
- Changes to Kubernetes manifests (`k8s/`, `manifests/`, `helm/`)
- Changes to Docker Compose files used in production
- Any IaC change targeting a production or staging environment

## Required behavior

1. **Terraform:** Run `terraform plan` against the target workspace and review the diff. Flag any `destroy` or resource replacement operations; require explicit approval before proceeding.
2. **Ansible:** Run `ansible-playbook --check --diff` against the target inventory. Flag any tasks reporting `changed`; verify they are expected.
3. **Kubernetes:** Run `kubectl diff -f manifests/` or `helm diff upgrade` against the target cluster. Flag any unexpected deletions or spec changes.
4. **Drift detected:** If the plan shows changes beyond those in the PR, document the out-of-band changes, open a follow-up issue, and do not merge until reconciled.
5. **Output:** Summarize the plan diff in the PR description with a "drift check passed" / "drift check flagged" status and the output.

## When NOT to use

- Local development or sandbox environments where drift is expected
- Documentation-only or comment changes with no behavioral impact
- New environments being provisioned for the first time

## When to escalate

If `terraform plan` proposes destroying stateful resources (databases, volumes, queues), stop and request a synchronous review before proceeding. Data loss is not recoverable.
