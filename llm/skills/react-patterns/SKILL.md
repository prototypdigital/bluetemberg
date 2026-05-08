---
name: react-patterns
description: Apply React component patterns — composition, co-location, and hook extraction — before reaching for custom solutions.
profiles:
  - frontend
  - fullstack
---

# react-patterns

Use this skill when implementing or reviewing React components, hooks, or state management.

## Triggers

- New React component or hook implementation
- Component is growing too large or has mixed responsibilities
- State is being lifted or passed through multiple layers
- A custom hook is being written to wrap browser APIs or third-party libs

## Required behavior

1. The agent MUST prefer composition over prop-drilling: split into smaller components and pass children or render props before adding new props.
2. The agent MUST co-locate state and effects with the component that owns them; only lift state when two siblings genuinely need it.
3. The agent MUST extract logic into a custom hook when a component contains non-trivial side effects or derived state that could be reused.
4. The agent MUST check for existing hooks or components in the codebase before introducing new abstractions.
5. The agent SHOULD use the project's shared design-system components instead of reimplementing layout primitives.

## When NOT to use

- Server components or non-React rendering contexts
- Trivial presentational components with no logic
- Generated or third-party component wrappers
