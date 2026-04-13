---
description: Use structured error responses and never leak internal details.
scope:
  - "src/api/**"
  - "src/routes/**"
  - "src/controllers/**"
---

# API error handling

All API endpoints must return structured, consistent error responses. Never expose stack traces, internal paths, or database details to clients.

## Response format

Always return errors with a consistent shape:

```json
{ "error": { "code": "NOT_FOUND", "message": "Resource not found" } }
```

## Rules

- Map internal errors to appropriate HTTP status codes.
- Log the full error server-side; return only a safe summary to the client.
- Use a centralized error handler rather than try/catch in every route.
- Validate request input at the boundary and return 400 with field-level details.
- Never return raw database errors, ORM messages, or file paths.
