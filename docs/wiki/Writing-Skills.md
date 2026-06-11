# Writing Skills

Skills live in `llm/skills/<skill-name>/SKILL.md`. Each skill is a directory containing a single `SKILL.md` file.

## Rules vs Skills

Rules and skills serve different purposes:

| | Rules | Skills |
| --- | ----- | ------ |
| **When active** | Always-on, passive context | On-demand, invoked explicitly |
| **What they do** | Set constraints and standards | Define multi-step workflows |
| **How they're read** | Every interaction | Only when triggered |
| **Example** | "Run the formatter before committing" | "Audit this PR for security issues" |

Use a **rule** when the behavior should happen automatically on every interaction. Use a **skill** when the behavior requires judgment, multiple steps, or is only relevant in specific situations.

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

## Required behavior

1. The agent MUST [required action].
2. The agent SHOULD [recommended action].
3. The agent MAY [optional action].

## Examples

- Example scenario and expected behavior

## When NOT to use

- Situations where this skill should be skipped
```

## Frontmatter fields

### `name` (required)

Matches the directory name. Kebab-case.

### `description` (required)

One-line description of the skill's purpose.

## How skills are synced

Skills are copied **verbatim** to target platforms. The directory structure is preserved:

| Source                         | Cursor                             | Claude                             | Copilot                            |
| ------------------------------ | ---------------------------------- | ---------------------------------- | ---------------------------------- |
| `llm/skills/patterns/SKILL.md` | `.cursor/skills/patterns/SKILL.md` | `.claude/skills/patterns/SKILL.md` | `.github/skills/patterns/SKILL.md` |

## Naming convention

- Each skill is a **directory** containing `SKILL.md`
- Directory name should be **kebab-case**: `docs-upkeep`, `workspace-hygiene`

## Official skill packages

Official skills ship as `bluetemberg-skills-*` packages from [prototypdigital/bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs). The init wizard writes an `llm/skill-packages.json` manifest; run `bluetemberg install` to download them.

| Package | Tags | Description |
| ------- | ---- | ----------- |
| `bluetemberg-skills-patterns` | frontend, backend, fullstack | Apply reusable architecture and coding patterns |
| `bluetemberg-skills-docs-upkeep` | all | Keep docs aligned with implementation changes |
| `bluetemberg-skills-workspace-hygiene` | all | On-demand workspace audit — review change scope, clean temp artifacts |
| `bluetemberg-skills-react-patterns` | frontend, fullstack | Component composition, hook extraction, and state co-location for React projects |
| `bluetemberg-skills-code-review` | frontend, backend, fullstack | Structured review checklist for PRs |
| `bluetemberg-skills-api-design` | backend, fullstack | RESTful conventions, pagination, versioning |
| `bluetemberg-skills-security-audit` | backend, fullstack, devops | Dependency audit, secrets scan, OWASP patterns |
| `bluetemberg-skills-ci-cd-best-practices` | devops | Pipeline optimization, caching strategies |
| `bluetemberg-skills-migration-safety` | backend, fullstack | Database migration review, rollback plans |
| `bluetemberg-skills-stack-change-review` | devops | High-blast-radius infrastructure change review |
| `bluetemberg-skills-infrastructure-drift-check` | devops | Verify declared IaC state matches deployed state before merge |
| `bluetemberg-skills-rollback-plan` | devops | Require tested rollback steps for every production change |

You can also write custom local skills directly in `llm/skills/` — local files always take priority over package content.

## Writing a good skill

- **Define clear triggers.** The AI needs to know when to activate the skill, and so does the human invoking it.
- **Use RFC 2119 keywords** (MUST, SHOULD, MAY) for behavior requirements.
- **Include a "When NOT to use" section.** Prevents over-application in situations where the skill adds noise.
- **Keep skills focused on a single workflow.** If a skill covers both security auditing and code review, split it.
- **Link to canonical documentation** rather than restating full policies.
- After creating or editing skills, run `npx bluetemberg sync`.
