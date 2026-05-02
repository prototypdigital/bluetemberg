---
name: stack-change-review
description: Review high-blast-radius infrastructure changes for safety before merge.
---

# stack-change-review

Use this skill when reviewing changes to critical infrastructure files that affect deployed services.

## Triggers

- Changes to `docker-compose*.yml`, `docker-compose*.yml.j2`
- Changes to `group_vars/all.yml` or `group_vars/*/*.yml`
- Changes to Ansible host inventory files
- Changes to `.env` or `.env.j2` files that define service config or secrets
- Changes to Kubernetes manifests (`k8s/`, `manifests/`, `helm/`)
- Changes to Terraform root module (`*.tf` in the project root)

## Required behavior

1. **Port changes:** Flag any port number change (breaks firewall rules and dependent containers).
2. **Volume paths:** Flag any volume rename or path change (data loss risk).
3. **Image tags:** For each image version bump, check if there are breaking API changes in the release notes.
4. **Service names:** Flag any service rename (breaks existing `docker compose down` and references).
5. **Environment variables:** Flag any var name or default value change (affects all consumers).
6. **Runbook update:** If any flag is raised, require a runbook or ADR update in the same commit explaining the change, rollback steps, and affected systems.

## When to use

- Before merging high-impact infra changes to main
- When making changes to production-adjacent files (`group_vars/all.yml`, `docker-compose.prod.yml.j2`)
- When the change affects multiple services or shared resources

## When NOT to use

- Documentation-only changes unrelated to deployed config
- Comments or formatting changes with no behavioral impact
- Adding new services that don't rename or change existing ones
