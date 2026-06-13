---
name: create-skill
description: Scaffold a new bluetemberg skill in the correct format — frontmatter, five required sections, and sync.
---

# create-skill

Use this skill when asked to add, create, or write a new skill for the project.

## Triggers

- "add a skill that..."
- "create a skill for..."
- "write a skill to..."
- Any request to scaffold a new on-demand workflow for the AI tooling

## Required behavior

1. The agent MUST check `llm/skills/` for an existing skill with the same name or purpose before creating anything. If one exists, report it and stop.

2. The agent MUST gather the following before writing any file — if any is unclear from the request, ask:
   - **name**: kebab-case identifier matching the workflow (e.g. `api-design`, `migration-safety`)
   - **description**: one tight sentence — dash-separated clauses, imperative voice (mirror existing examples: *"Structured code review — intent-first, diff-focused…"*)
   - **profiles**: which team profiles apply (`frontend`, `backend`, `fullstack`, `devops`, `pure-infra`, `custom`); omit the field entirely if the skill is universal

3. The agent MUST create the file at exactly `llm/skills/{name}/SKILL.md` — never any other path or filename.

4. The agent MUST include all five sections in this order:

   **Opening paragraph** — `Use this skill when [trigger context].`

   **`## Triggers`** — concrete invocation phrases or verbs, not vague category names; at least two entries

   **`## Required behavior`** — numbered steps using RFC 2119 keywords with the correct authority level:
   - MUST = non-negotiable; the skill fails if skipped
   - SHOULD = strongly recommended; may be skipped with justification
   - MAY = optional enhancement

   **`## Examples`** — at least one concrete scenario showing input → expected output

   **`## When NOT to use`** — at least one exclusion to prevent over-firing

5. The agent MUST run `npm run sync:llm-config` after writing the file. This propagates the skill to all platform directories (`.claude/skills/`, `.cursor/skills/`, `.github/skills/`). Do not report the skill as created until sync succeeds.

6. The agent MUST NOT create a skill for behavior that belongs in a rule. Use a **rule** when the behavior is always-on and passive. Use a **skill** when it requires explicit invocation, judgment, or multiple coordinated steps.

## Skill template

```
---
name: {kebab-case-name}
description: {One tight sentence.}
profiles:           # omit this block entirely if universal
  - frontend
---

# {name}

Use this skill when [trigger context].

## Triggers

- "trigger phrase one"
- "trigger phrase two"

## Required behavior

1. The agent MUST [required action].
2. The agent SHOULD [recommended action].
3. The agent MAY [optional action].

## Examples

- Scenario description → expected output or behavior

## When NOT to use

- Situation where this skill adds noise or is wrong tool for the job
```

## Examples

- "Add a skill that audits API endpoints for REST conventions" → creates `llm/skills/api-design/SKILL.md` with `backend` + `fullstack` profiles, triggers on API review requests, Required behavior covering naming, status codes, pagination, versioning
- "Create a skill that checks database migrations before merge" → creates `llm/skills/migration-safety/SKILL.md` with `backend` + `fullstack` profiles

## When NOT to use

- The behavior should fire on every interaction — write a rule in `llm/rules/` instead
- A skill covering the same workflow already exists in `llm/skills/`
- The request is to install an official pack, not author a custom local skill
