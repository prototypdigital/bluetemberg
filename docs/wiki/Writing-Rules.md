# Writing Rules

Rules live in `llm/rules/` as Markdown files with YAML frontmatter.

## Format

```markdown
---
description: Short description of what this rule enforces.
scope: '**'
---

# Rule Title

Rule content in Markdown. This is what the AI assistant sees.
```

## Frontmatter fields

### `description` (required)

A one-line description of the rule. Used as metadata in all platform outputs.

### `scope` (optional, default: `'**'`)

Controls which files the rule applies to.

| Value                  | Meaning                                 |
| ---------------------- | --------------------------------------- |
| `'**'`                 | Global — applies to all files           |
| `'src/**'`             | Applies only to files matching the glob |
| `['src/**', 'lib/**']` | Multiple glob patterns                  |

## How scope is transformed

The sync engine converts `scope` into platform-specific frontmatter:

| Source scope       | Cursor                    | Claude                    | Copilot                |
| ------------------ | ------------------------- | ------------------------- | ---------------------- |
| `'**'`             | `alwaysApply: true`       | `paths: ['**']`           | `applyTo: '**'`        |
| `'src/**'`         | `globs: ['src/**']`       | `paths: ['src/**']`       | `applyTo: 'src/**'`    |
| `['a/**', 'b/**']` | `globs: ['a/**', 'b/**']` | `paths: ['a/**', 'b/**']` | `applyTo: 'a/**,b/**'` |

## Naming convention

- Use **kebab-case** for filenames: `coding-standards.md`, `no-console-log.md`
- The filename (minus `.md`) becomes the output filename stem across all platforms

## Available starter rules

| Rule                    | Scope    | Description                      |
| ----------------------- | -------- | -------------------------------- |
| `coding-standards`      | `**`     | Function complexity, readability |
| `no-console-log`        | `src/**` | Use logger instead of console.\* |
| `git-move`              | `**`     | Use git mv for tracked files     |
| `never-read-env`        | `**`     | Never read .env in code          |
| `post-edit-diagnostics` | `**`     | Run diagnostics after edits      |
| `design-system-reuse`   | `**`     | Reuse shared UI components       |

## Tips

- Keep rules concise and actionable — the AI reads them on every interaction
- Use examples (code blocks) to clarify expected behavior
- One rule per file — easier to enable/disable individually
- After creating or editing rules, run `npx blueprint sync`
