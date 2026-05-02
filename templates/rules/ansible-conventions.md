---
description: Follow Ansible best practices for idempotent, maintainable infrastructure automation.
scope:
  - "**/ansible/**/*.yml"
  - "**/ansible/**/*.yaml"
  - "**/*.j2"
---

# Ansible conventions

Write Ansible roles and playbooks that are idempotent, readable, and maintainable.

## Modules and naming

- Use fully qualified collection names (FQCN): `ansible.builtin.copy` not `copy`.
- Every task must have a descriptive `name:`.
- Avoid `shell` and `command` modules; prefer native modules.
- When `shell`/`command` is unavoidable, always set `changed_when:` and `failed_when:`.

## Idempotency and safety

- Every task must be safe to re-run without changing the system state.
- Use `ansible-lint --profile production` before committing.
- Test with `--check --diff` to verify idempotency.

## Secrets and handlers

- Tasks handling secrets must set `no_log: true`.
- Handlers run only on change; use them for service restarts, not side effects.
- Never hardcode passwords; use `vars_prompt`, vault, or env lookups.

## Role structure

- Follow standard layout: `defaults/`, `tasks/`, `handlers/`, `templates/`, `files/`, `vars/`.
- Define all variables in `defaults/main.yml` with safe defaults.
- Keep tasks in `tasks/main.yml` focused; extract to `tasks/subtask.yml` when >20 lines.

## Jinja2 templating

- Always use `| default()` filter for optional variables to prevent undefined errors.
- Use `| to_json` or `| to_yaml` when embedding structured data.
- Keep logic in tasks; templates render, not compute.
- All referenced variables must be defined in `defaults/` or `group_vars/`.
