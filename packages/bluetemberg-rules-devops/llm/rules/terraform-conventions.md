---
description: Follow Terraform module structure and naming conventions.
scope:
  - "**/*.tf"
  - "**/*.tfvars"
---

# Terraform conventions

Keep infrastructure-as-code consistent, readable, and modular.

## Structure

- One module per logical resource group (e.g. `modules/vpc/`, `modules/rds/`).
- Every module has `main.tf`, `variables.tf`, and `outputs.tf`.
- Root module composes child modules; avoid putting resources directly in root.

## Naming

- Use snake_case for all resource names, variables, and outputs.
- Prefix resources with their type when names would be ambiguous.
- Tag all resources with `environment`, `team`, and `managed_by = "terraform"`.

## State and safety

- Never store state locally in shared environments; use remote backends.
- Use `prevent_destroy` lifecycle rules on critical resources.
- Pin provider versions in `required_providers`.
- Run `terraform plan` before every apply and review the diff.
