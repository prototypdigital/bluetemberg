# Registry

The Community Rule Registry lets you install, share, and manage reusable rule packs published to npm.

## Concepts

A **rule pack** is an npm package that bundles vendor-neutral rules, agents, and/or skills in the standard `llm/` directory layout. Packs are installed into a local cache (`.bluetemberg/packs/`) and automatically included during sync — lower priority than local sources and `extends` entries.

### Pack layout

A rule pack is any npm package containing an `llm/` directory (or rules/agents/skills at the package root):

```
my-rules-pack/
  package.json          # must include "bluetemberg-pack" keyword for discovery
  llm/
    rules/
      typescript-strict.md
      no-any.md
    agents/
      reviewer.md
```

## Manifest and lockfile

Two files track installed packs:

| File | Purpose | Commit? |
| ---- | ------- | ------- |
| `llm/packages.json` | Manifest — package names and semver ranges | Yes |
| `llm/packages-lock.json` | Lockfile — exact versions, tarball URLs, integrity hashes | Yes |

Both should be committed so the team pins the same versions.

One manifest covers all pack kinds — rules, agents, skills, and guardrails. A pack declares what it ships through its `llm/` directory layout, so a single package can mix kinds (e.g. a framework pack with both rules and a skill).

> **Migrating from kind-split manifests:** projects scaffolded before the unification may still have `rule-packages.json`, `agent-packages.json`, or `skill-packages.json`. They keep working — `sync` merges them in memory with a warning — and the next `bluetemberg install` (or `add`/`update`/`remove`) consolidates them into `packages.json` and deletes the legacy files. Commit the result.

### Manifest format

```json
{
  "registry": "https://registry.npmjs.org",
  "packages": {
    "@company/rules-frontend": "^1.2.0",
    "community-ts-rules": "~2.0.0"
  }
}
```

| Field | Required | Description |
| ----- | -------- | ----------- |
| `registry` | No | Custom npm registry URL. Defaults to `https://registry.npmjs.org`. |
| `packages` | Yes | Map of package name to semver range. |

### Lockfile format

```json
{
  "lockfileVersion": 1,
  "packages": {
    "@company/rules-frontend": {
      "version": "1.2.3",
      "resolved": "https://registry.npmjs.org/@company/rules-frontend/-/rules-frontend-1.2.3.tgz",
      "integrity": "sha512-abc123...",
      "keyid": "SHA256:jl3bwswu80PjjokCgh0o2w5c2U4LhQAE57gj4th9nn4"
    }
  }
}
```

The `keyid` field is recorded when the package is installed and holds the registry signing key id used to verify the ECDSA signature. It is present for all packages installed from the default npm registry and used by `bluetemberg verify` to confirm the signature is still valid.

## Commands

### `bluetemberg add <package>`

Install a rule pack from the npm registry.

```bash
bluetemberg add @company/rules-frontend
bluetemberg add @company/rules-frontend@^1.2.0
bluetemberg add community-ts-rules@latest
bluetemberg add community-ts-rules --version "~2.0.0"
```

**What it does:**

1. Fetches package metadata from the npm registry.
2. Resolves the best version matching the requested range.
3. Downloads and extracts the tarball to `.bluetemberg/packs/<name>/<version>/`.
4. Verifies the SHA-512 integrity hash.
5. Verifies the ECDSA registry signature against the npm public keys endpoint.
6. Updates `llm/packages.json` and `llm/packages-lock.json` (recording the signing `keyid`).
7. Adds `.bluetemberg/` to `.gitignore` if not already present.

After adding, run `bluetemberg sync` to generate platform-specific files that include the new rules.

**Options:**

| Option | Description |
| ------ | ----------- |
| `--version <range>` | Semver range (overrides `@version` in the package spec) |
| `--silent` | Suppress all output |

### `bluetemberg remove <package>`

Remove a rule pack from the project.

```bash
bluetemberg remove @company/rules-frontend
```

Removes the package from the manifest, lockfile, and local cache.

**Options:**

| Option | Description |
| ------ | ----------- |
| `--silent` | Suppress all output |

### `bluetemberg list`

List all installed rule packs with their resolved versions.

```bash
bluetemberg list
```

**Options:**

| Option | Description |
| ------ | ----------- |
| `--silent` | Suppress all output |

### `bluetemberg install`

Install all packs from the manifest. Similar to `npm ci` — reads the manifest, uses locked versions when available, and downloads missing packs.

```bash
bluetemberg install
bluetemberg install --force
```

Run this after cloning a repo or when the lockfile has new entries from a teammate.

**Options:**

| Option | Description |
| ------ | ----------- |
| `--force` | Force re-download even if cached |
| `--silent` | Suppress all output |

### `bluetemberg update [package]`

Re-resolve and upgrade rule packs to the best version satisfying their current manifest range.

```bash
bluetemberg update                  # re-resolves all manifest packs
bluetemberg update @company/rules   # re-resolves a single pack
bluetemberg update --latest         # widens all ranges to "latest" in the manifest
```

**What it does (for each pack):**

1. Fetches the latest metadata from the registry.
2. Resolves the best version satisfying the current range (or `"latest"` if `--latest`).
3. Downloads and installs the new version if it differs from the locked one.
4. Removes the previously cached version when the version changed.
5. Updates `llm/packages-lock.json` (and `llm/packages.json` when `--latest`).
6. Logs what changed (e.g. `@company/rules 1.0.0 → 1.2.3`).

After updating, run `bluetemberg sync` to apply the changes.

**Options:**

| Option | Description |
| ------ | ----------- |
| `--latest` | Widen each pack's range to `"latest"` in the manifest, not just re-resolve the current range |
| `--silent` | Suppress all output |

### `bluetemberg verify`

Verify the integrity and ECDSA registry signatures of all installed packs.

```bash
bluetemberg verify
bluetemberg verify /path/to/project
bluetemberg verify --skip-signature-verification   # for self-hosted registries
```

**What it does:**

For each pack in the lockfile:
1. Checks that the pack directory and `.bluetemberg-integrity` marker exist in the cache.
2. Confirms the marker hash matches the lockfile entry.
3. Fetches fresh registry metadata and verifies the ECDSA P-256 signature.

Exits with code `1` if any pack fails verification.

**Options:**

| Option | Description |
| ------ | ----------- |
| `--skip-signature-verification` | Skip the ECDSA check (for self-hosted registries that do not sign packages) |
| `--silent` | Suppress all output |

### `bluetemberg search <query>`

Search the npm registry for rule packs. By default only returns packages with the `bluetemberg-pack` keyword.

```bash
bluetemberg search typescript
bluetemberg search frontend rules --limit 10
```

**Options:**

| Option | Description |
| ------ | ----------- |
| `--limit <n>` | Max results (default: 20) |
| `--silent` | Suppress all output |

## Priority order

During sync, source directories are resolved in this priority (highest first):

1. **Local** `llm/` directory
2. **`extends`** entries (in array order)
3. **Registry packs** (in manifest order)

When the same rule filename appears in multiple sources, the higher-priority source wins. This means local rules always override pack rules, and you can selectively override individual rules from a pack.

## Security

Every pack install goes through two layers of verification:

1. **SHA-512 integrity** — the downloaded tarball is hashed and compared against the value recorded in the npm registry metadata. A mismatch aborts installation immediately.

2. **ECDSA registry signature** — npm signs each package with a P-256 private key. Bluetemberg fetches the corresponding public keys from `/-/npm/v1/keys`, verifies the signature over `${name}@${version}:${integrity}`, and records the matching `keyid` in the lockfile.

The default npm registry (`registry.npmjs.org`) always signs packages. Bluetemberg enforces this: an unsigned package from the default registry is rejected as a potential supply-chain attack, even if the integrity hash matches.

For **self-hosted or private registries** that do not produce signatures, pass `--skip-signature-verification` to `bluetemberg install`/`bluetemberg add`, or set `skipSignatureVerification: true` in the programmatic API. This flag has no effect against the default registry.

Run `bluetemberg verify` at any time to re-check all installed packs without re-downloading them.

## Cache directory

Downloaded packs are extracted to `.bluetemberg/packs/<name>/<version>/`. This directory:

- Should be added to `.gitignore` (done automatically on first `add`/`install`).
- Can be deleted and restored via `bluetemberg install`.
- Includes an integrity marker file (`.bluetemberg-integrity`) for cache validation.

## Official packs

Bluetemberg's official packs live in **[prototypdigital/bluetemberg-packs](https://github.com/prototypdigital/bluetemberg-packs)** and publish independently to npm. They cover rules, agents, and skills grouped by domain.

### Rule packs

| Package | Domain |
|---------|--------|
| `bluetemberg-rules-typescript` | TypeScript code quality |
| `bluetemberg-rules-git` | Git workflow standards |
| `bluetemberg-rules-security` | Security guardrails |
| `bluetemberg-rules-docs` | Documentation & diagnostics |
| `bluetemberg-rules-devops` | Infrastructure |

### Agent packs

| Package | Agent |
|---------|-------|
| `bluetemberg-agents-frontend-specialist` | Frontend specialist |
| `bluetemberg-agents-backend-specialist` | Backend specialist |
| `bluetemberg-agents-test-specialist` | Test specialist |
| `bluetemberg-agents-docs-maintainer` | Docs maintainer |
| `bluetemberg-agents-code-reviewer` | Code reviewer |
| `bluetemberg-agents-a11y-specialist` | Accessibility specialist |
| `bluetemberg-agents-security-specialist` | Security specialist |
| `bluetemberg-agents-infrastructure-specialist` | Infrastructure specialist |
| `bluetemberg-agents-devops-specialist` | DevOps specialist |
| `bluetemberg-agents-ansible-specialist` | Ansible specialist |
| `bluetemberg-agents-kubernetes-specialist` | Kubernetes specialist |
| `bluetemberg-agents-sre-specialist` | SRE specialist |

### Skill packs

| Package | Skill |
|---------|-------|
| `bluetemberg-skills-patterns` | Patterns |
| `bluetemberg-skills-docs-upkeep` | Docs upkeep |
| `bluetemberg-skills-workspace-hygiene` | Workspace hygiene |
| `bluetemberg-skills-react-patterns` | React patterns |
| `bluetemberg-skills-code-review` | Code review |
| `bluetemberg-skills-api-design` | API design |
| `bluetemberg-skills-security-audit` | Security audit |
| `bluetemberg-skills-ci-cd-best-practices` | CI/CD best practices |
| `bluetemberg-skills-migration-safety` | Migration safety |
| `bluetemberg-skills-stack-change-review` | Stack change review |
| `bluetemberg-skills-infrastructure-drift-check` | Infrastructure drift check |
| `bluetemberg-skills-rollback-plan` | Rollback plan |

### Guardrail packs

| Package | Guardrails |
|---------|------------|
| `bluetemberg-guardrails-git` | Conventional branch names for AI-created worktrees |

See [Guardrails](Guardrails) for the format and how they map to platform hooks.

For the full catalog, see the [bluetemberg-packs wiki](https://github.com/prototypdigital/bluetemberg-packs/wiki/Catalog).

### Using collections via init

When running `bluetemberg init`, select **Rule collections (registry packages)** as the rule source. The wizard will suggest collections based on your team profile and write a `llm/packages.json` manifest. Then run `bluetemberg install` to download the packages.

### Using collections manually

```bash
bluetemberg add bluetemberg-rules-typescript
bluetemberg add bluetemberg-rules-git
bluetemberg install
bluetemberg sync
```

Local rules in `llm/rules/` always take priority over collection rules, so you can override any rule by creating a file with the same name.

## Publishing a rule pack

To publish your own rule pack:

1. Create a standard npm package with an `llm/` directory containing your rules, agents, and/or skills.
2. Add `"bluetemberg-pack"` to the `keywords` array in `package.json` for discoverability.
3. Publish to npm (or a private registry).

```json
{
  "name": "@company/rules-frontend",
  "version": "1.0.0",
  "keywords": ["bluetemberg-pack", "rules", "frontend"],
  "files": ["llm/"]
}
```

## Private registries

Set the `registry` field in `llm/packages.json` to use a private npm registry:

```json
{
  "registry": "https://npm.pkg.github.com",
  "packages": {
    "@company/internal-rules": "^1.0.0"
  }
}
```

## Programmatic API

All registry operations are available as named exports:

```ts
import {
  registryAdd,
  registryRemove,
  registryList,
  registryInstall,
  registryUpdate,
  registrySearch,
  resolvePackSourceDirs,
} from 'bluetemberg';

// Add a pack
await registryAdd('/path/to/project', 'my-rules@^1.0.0');

// Update all packs to the latest satisfying version
await registryUpdate('/path/to/project');

// Update a single pack
await registryUpdate('/path/to/project', '@company/rules');

// Widen all ranges to "latest"
await registryUpdate('/path/to/project', undefined, { latest: true });

// List installed packs
const packs = registryList('/path/to/project', { silent: true });

// Resolve pack source dirs for custom sync logic
const dirs = resolvePackSourceDirs('/path/to/project');
```
