---
description: Forbid console.log in production code; use a logger instead.
scope: "src/**"
---

# No console.log in production code

Never use `console.log` (or `console.warn`, `console.error`, `console.debug`) directly in source files under `src/`.

Use the project logger instead so that log output is structured, level-controlled, and safe to ship.

## Examples

```ts
// BAD
console.log("Fetching page", slug);
console.error("Something went wrong", err);

// GOOD
logger.info("Fetching page", { slug });
logger.error("Something went wrong", { error: err });
```

## Why

- `console.*` calls leak implementation details and unstructured output into production.
- A logger allows log-level filtering, structured metadata, and integration with observability tooling.
