---
name: code-review
description: Structured code review — intent-first, diff-focused, severity-tiered findings with actionable fix suggestions.
profiles:
  - frontend
  - backend
  - fullstack
---

# code-review

Use this skill when reviewing a pull request or a set of code changes before merge.

## Triggers

- Pull request review (any size)
- Post-implementation self-review before opening a PR
- Peer review requested by a teammate

## Procedure

Work through the following steps in order. Do not skip steps for small changes.

### Step 1 — Understand intent

Before looking at code, establish what the change is supposed to accomplish:

```bash
git log --oneline origin/main..HEAD   # commits on this branch
git diff --stat origin/main..HEAD     # files and line counts changed
```

If a PR description or issue link is available, read it. Summarize the intent in one sentence before proceeding. This anchors your review — a finding is only valid if it conflicts with the stated intent or introduces unacceptable risk.

### Step 2 — Read the diff, not the files

```bash
git diff origin/main..HEAD
```

Focus on changed lines and their immediate context (the enclosing function or block). Do not read entire files unless a change cannot be understood without broader context.

### Step 3 — Reason before critiquing

For each changed area, trace the execution path:
1. What does this code do now (after the change)?
2. What are the inputs and their valid ranges?
3. What can go wrong (error paths, edge cases, concurrent access)?
4. Does the change match the stated intent?

Only raise a finding once you can state a concrete consequence, not a theoretical one.

### Step 4 — Issue findings

Format every finding using Conventional Comments labels:

```
<label>(<optional-scope>): <what in one sentence>

<why — one or two sentences on the consequence if not fixed>

<fix — corrected snippet or concrete alternative, if applicable>
```

**Labels and severity:**

| Label | Severity | Meaning |
|---|---|---|
| `issue` | Critical | Must be fixed before merge — correctness bug, security vulnerability, or data loss risk |
| `warning` | Major | Concrete regression or pattern that will likely cause problems; strongly recommended to fix |
| `suggestion` | Minor | Worth considering; optional but improves quality |
| `nitpick` | Nit | Purely stylistic, no behavioral impact; author can ignore |
| `praise` | Positive | Something done well — cite it specifically |

**Always include** a file and line reference for each finding: `src/foo.ts:42`.

### Step 5 — Write a summary

After all findings, write a short summary (3–6 sentences):

1. One sentence restating the PR intent.
2. Count of findings by severity (e.g., "1 issue, 2 warnings, 3 suggestions").
3. A merge verdict: **Block** (has `issue`-level findings) / **Request changes** (has `warning`-level) / **Approve with suggestions** / **Approve**.
4. One specific `praise` — cite a file and line, not a generic compliment.

## Categories to check

Check these categories explicitly in order of priority:

1. **Correctness** — logic errors, wrong conditions, off-by-one, incorrect state transitions
2. **Security** — injection vectors, auth bypass, hardcoded secrets, unsafe deserialization, exposed internals in error responses
3. **Error handling** — unhandled rejection, swallowed exceptions, missing fallbacks at system boundaries
4. **API contracts** — breaking changes to public interfaces, unexpected type widening, missing validation on external input
5. **Performance** — O(n²) where O(n) is achievable, unnecessary allocations in hot paths, N+1 queries
6. **Tests** — new behavior with no test coverage, tests that only test the happy path

## What NOT to comment on

Do not raise findings for:

- Formatting, indentation, or whitespace — delegate to the project formatter
- Style preferences without a project style-guide reference
- Speculative "this could theoretically fail if..." warnings with no concrete path
- Issues already caught by CI (type errors, lint failures, failing tests reported in the pipeline)
- Vendored or generated code outside the PR author's control

## When NOT to use

- Automated formatting-only PRs (no behavior change)
- Generated code (migrations created by a tool, lock file updates)
- Work-in-progress draft PRs explicitly not ready for review
