---
name: code-review
description: Apply a structured code review checklist covering correctness, naming, complexity, and tests.
---

# code-review

Use this skill when reviewing code changes or pull requests.

## Triggers

- Pull request review
- Post-implementation self-review
- Peer code review requests

## Required behavior

1. The agent MUST check for logical correctness and edge cases first.
2. The agent MUST verify error handling covers all failure modes.
3. The agent MUST flag functions exceeding 30 lines or 3 levels of nesting.
4. The agent SHOULD verify naming is consistent with surrounding code.
5. The agent SHOULD check that new behavior has corresponding tests.
6. The agent SHOULD acknowledge well-written code, not just problems.

## When NOT to use

- Automated formatting or linting issues (defer to tools)
- Generated code or vendored dependencies
