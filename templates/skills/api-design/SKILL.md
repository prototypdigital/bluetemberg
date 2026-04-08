---
name: api-design
description: Apply RESTful API design conventions for endpoints, pagination, versioning, and error contracts.
---

# api-design

Use this skill when designing new API endpoints or reviewing existing API contracts.

## Triggers

- New endpoint or route creation
- API contract review or documentation
- Pagination, filtering, or sorting implementation

## Required behavior

1. The agent MUST follow RESTful resource naming (plural nouns, no verbs in paths).
2. The agent MUST use consistent pagination with `limit`/`offset` or cursor-based patterns.
3. The agent MUST return structured error responses with machine-readable codes.
4. The agent SHOULD version APIs via URL prefix (`/v1/`) or headers when breaking changes are needed.
5. The agent SHOULD document request/response shapes alongside implementation.

## When NOT to use

- Internal function-to-function calls (this is for HTTP API boundaries only)
- WebSocket or real-time event APIs (different conventions apply)
