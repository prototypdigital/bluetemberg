# Contributing

## Development setup

```bash
git clone https://github.com/prototypdigital/blueprint.git
cd blueprint
npm install
npm run build
npm test
```

## Scripts

| Script                 | Purpose                       |
| ---------------------- | ----------------------------- |
| `npm run build`        | Compile TypeScript to `dist/` |
| `npm run dev`          | Watch mode compilation        |
| `npm test`             | Run tests (vitest)            |
| `npm run test:watch`   | Watch mode tests              |
| `npm run lint`         | ESLint check                  |
| `npm run lint:fix`     | ESLint auto-fix               |
| `npm run format`       | Prettier format               |
| `npm run format:check` | Prettier check                |
| `npm run typecheck`    | TypeScript type check         |

## Project structure

```
src/
├── index.ts              # Public API exports
├── types.ts              # Shared TypeScript interfaces
├── utils/
│   └── fs.ts             # File system helpers
├── sync/
│   ├── index.ts          # Sync engine (read, transform, write)
│   └── transform.ts      # Frontmatter transform logic
└── init/
    ├── index.ts           # Init wizard orchestrator
    ├── prompts.ts         # Inquirer prompt definitions
    ├── presets.ts         # Available rule/agent/skill presets
    └── scaffold.ts        # File generation logic
```

## Commit conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/). All PR titles must follow the format:

```
type(scope): description
```

Common types:

- `feat` — new feature (triggers minor version bump)
- `fix` — bug fix (triggers patch version bump)
- `docs` — documentation only
- `chore` — maintenance, dependencies
- `refactor` — code change that neither fixes a bug nor adds a feature

Breaking changes: add `!` after the type, e.g. `feat!: remove sync v1 API`. This triggers a major version bump (or minor while pre-1.0).

## Pull request process

1. Create a feature branch from `main`
2. Make your changes
3. Ensure all checks pass: `npm run build && npm test && npm run lint && npm run format:check`
4. Open a PR with a conventional commit title
5. CODEOWNERS will be auto-requested for review
6. After merge, Release Please will open/update a release PR
7. When the release PR is merged, the package is published automatically

## Release process

Releases are fully automated via [Release Please](https://github.com/googleapis/release-please):

1. Conventional commits on `main` are analyzed
2. A "release PR" is opened with version bump and CHANGELOG update
3. A maintainer reviews and merges the release PR
4. A GitHub Release is created automatically
5. The publish workflow triggers and pushes to GitHub Packages

No manual version bumping or tagging is needed.

## Adding starter templates

To add a new starter rule, agent, or skill:

1. Add the template file to the appropriate `templates/` subdirectory
2. Add a preset entry in `src/init/presets.ts`
3. Run `npm test` to verify nothing breaks
4. Open a PR with `feat: add <name> starter template`
