---
description: Follow container best practices for secure, efficient Docker images.
scope:
  - "**/Dockerfile"
  - "**/Dockerfile.*"
  - "**/docker-compose*.yml"
  - "**/.dockerignore"
---

# Docker best practices

Build secure, minimal, and reproducible container images.

## Rules

- Use multi-stage builds to keep final images small.
- Run as a non-root user in the final stage.
- Pin base image versions (avoid `latest` tag in production).
- Copy dependency manifests and install before copying source (layer caching).
- Include a `.dockerignore` that excludes `node_modules`, `.git`, `.env`, and build artifacts.
- Use `HEALTHCHECK` instructions for production services.
- Prefer `COPY` over `ADD` unless extracting archives.
