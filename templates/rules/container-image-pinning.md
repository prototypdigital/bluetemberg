---
description: Pin container image versions to prevent unexpected breaking changes.
scope:
  - "**/docker-compose*.yml"
  - "**/docker-compose*.yml.j2"
  - "**/group_vars/**"
  - "**/host_vars/**"
  - "**/.env*"
---

# Container image pinning

Pin all container image versions to ensure reproducible, predictable deployments.

## Rules

- Never use `:latest` or `:main` tags in image references anywhere in the codebase.
- Pin to a specific semantic version: `:1.2.3`, `:v1.2.3-alpine`, or a content digest `:@sha256:abc123...`.
- When updating an image version, review the changelog or release notes for breaking API changes.
- Document the reason for any image version bump in the commit message.
- For base images in Dockerfile, pin to a release tag; avoid `FROM node:latest` or `FROM python:main`.

## Scope

This rule applies everywhere images are referenced:

- `docker-compose.yml` and `docker-compose.override.yml`
- Ansible `docker-compose*.yml.j2` templates
- `group_vars/`, `host_vars/` environment variable definitions
- `.env` files and templated `.env.j2`

## Verification

- Before committing, verify the pinned version exists in the registry.
- Use `docker pull image:tag` or check Docker Hub / Quay / ECR to confirm the digest exists.
- If using digest pins, verify the image is signed and matches your expected content.
