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
| `llm/rule-packages.json` | Manifest — package names and semver ranges | Yes |
| `llm/rule-packages-lock.json` | Lockfile — exact versions, tarball URLs, integrity hashes | Yes |

Both should be committed so the team pins the same versions.

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
      "integrity": "sha512-abc123..."
    }
  }
}
```

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
5. Updates `llm/rule-packages.json` and `llm/rule-packages-lock.json`.
6. Adds `.bluetemberg/` to `.gitignore` if not already present.

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

## Cache directory

Downloaded packs are extracted to `.bluetemberg/packs/<name>/<version>/`. This directory:

- Should be added to `.gitignore` (done automatically on first `add`/`install`).
- Can be deleted and restored via `bluetemberg install`.
- Includes an integrity marker file (`.bluetemberg-integrity`) for cache validation.

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

Set the `registry` field in `llm/rule-packages.json` to use a private npm registry:

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
  registrySearch,
  resolvePackSourceDirs,
} from '@prototypdigital/bluetemberg';

// Add a pack
await registryAdd('/path/to/project', 'my-rules@^1.0.0');

// List installed packs
const packs = registryList('/path/to/project', { silent: true });

// Resolve pack source dirs for custom sync logic
const dirs = resolvePackSourceDirs('/path/to/project');
```
