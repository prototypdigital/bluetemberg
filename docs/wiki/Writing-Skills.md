# Writing Skills

Skills live in `llm/skills/<skill-name>/SKILL.md`.

## Format

```markdown
---
name: skill-name
description: One-line description of what this skill does.
---

# skill-name

Use this skill when [trigger context].

## Triggers

- `trigger-keyword-1`
- `trigger-keyword-2`

## Inputs

- `inputName` (type, required/optional): description

## Outputs

- `outputName` (type): description

## Required behavior

1. The agent MUST [required action].
2. The agent SHOULD [recommended action].
3. The agent MAY [optional action].

## References

- path/to/related/doc.md
```

## Frontmatter fields

### `name` (required)

Matches the directory name. Kebab-case.

### `description` (required)

One-line description of the skill's purpose.

## How skills are synced

Skills are copied **verbatim** to target platforms. The directory structure is preserved:

| Source                         | Claude                             | Copilot                            |
| ------------------------------ | ---------------------------------- | ---------------------------------- |
| `llm/skills/patterns/SKILL.md` | `.claude/skills/patterns/SKILL.md` | `.github/skills/patterns/SKILL.md` |

## Naming convention

- Each skill is a **directory** containing `SKILL.md`
- Directory name should be **kebab-case**: `docs-upkeep`, `workspace-hygiene`

## Available starter skills

| Skill               | Description                                     |
| ------------------- | ----------------------------------------------- |
| `patterns`          | Apply reusable architecture and coding patterns |
| `docs-upkeep`       | Keep docs aligned with implementation changes   |
| `workspace-hygiene` | Clean workspace state during edits              |

## Tips

- Use RFC 2119 keywords (MUST, SHOULD, MAY) for behavior requirements
- Keep skills focused on a single workflow
- Link to canonical documentation rather than restating full policies
