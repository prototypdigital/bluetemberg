---
description: Run formatter, linter, and build checks before every commit.
scope: "**"
---

# Pre-commit checks

Before committing any changes, verify the workspace is clean and CI-ready.

## Required steps

1. Run the project formatter on all modified files.
2. Run the linter and fix any new warnings introduced by the changes.
3. Verify the build or type-check passes.
4. Never commit files that have unresolved diagnostics, type errors, or lint failures.

## Tool-specific checks

### Application code (JavaScript, TypeScript, Python, etc.)

- **Formatter:** Run `prettier --write`, `black`, `gofmt`, or equivalent.
- **Linter:** Run `eslint --fix`, `pylint`, `golangci-lint`, or equivalent.
- **Build/type-check:** Run `tsc --noEmit`, `npm run build`, `cargo check`, or equivalent.

### Infrastructure-as-code (Terraform, Ansible, Kubernetes)

- **Terraform:** Run `terraform fmt` and `terraform validate`.
- **Ansible:** Run `yamllint` and `ansible-lint --profile production` on playbooks.
- **Kubernetes/Helm:** Run `yamllint`, `helm lint`, `kubeconform`, or `kube-score`.
- **Shell scripts:** Run `shellcheck` on all `*.sh` files and fix warnings.

### Configuration files (YAML, JSON, etc.)

- **YAML:** Run `yamllint` on all `.yml` and `.yaml` files.
- **JSON:** Use a formatter like `prettier` or language-specific tools.
- **Jinja2 templates:** Run `yamllint` on rendered output where possible; lint for undefined variables.

## Scope

This applies to every commit — feature work, refactors, docs, config changes. No exceptions.
If a formatter or linter config exists in the project, respect it. If `.prettierignore`, `.eslintignore`, or tool-specific ignore files exclude certain paths, do not force-format those paths.
