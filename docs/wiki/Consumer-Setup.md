# Consumer Setup

How to set up a downstream project to use Blueprint.

## 1. Authenticate with GitHub Packages

Add or create `.npmrc` in your project root:

```
@prototypdigital:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Set `GITHUB_TOKEN` to a personal access token with `read:packages` scope.

**For CI (GitHub Actions):**

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '20'
    registry-url: 'https://npm.pkg.github.com'
    scope: '@prototypdigital'
  env:
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## 2. Initialize

```bash
npx @prototypdigital/blueprint init
```

Follow the interactive prompts to select platforms, rules, agents, and skills.

## 3. Add sync check to CI

Add to your GitHub Actions workflow to catch drift:

```yaml
- name: Check AI config sync
  run: npx blueprint sync --check
```

## 4. Ongoing workflow

After editing any file in `llm/`:

```bash
# Regenerate platform files
npm run sync:llm-config

# Verify in CI
npm run sync:llm-config:check
```

## Updating Blueprint

To get the latest starter templates and sync engine:

```bash
npm update @prototypdigital/blueprint
```

Then re-run sync to pick up any engine changes:

```bash
npx blueprint sync
```

## Migrating from manual setup

If your project already has AI config files (`.cursor/rules/`, `.claude/rules/`, etc.) that were created manually:

1. Run `npx @prototypdigital/blueprint init` in your project
2. Move your existing rule content into `llm/rules/` with the correct frontmatter format
3. Run `npx blueprint sync` to regenerate platform files
4. Verify the output matches your previous setup
5. Delete any manually-created platform files that are now generated
