# Consumer Setup

How to set up a downstream project to use Bluetemberg.

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
npx @prototypdigital/bluetemberg init
```

Follow the interactive prompts to select platforms, rules, agents, and skills. Available platforms: **Cursor**, **Claude Code**, **GitHub Copilot**, **Gemini CLI**.

**Monorepo or shared rule packs?** Skip `init` on child packages — instead create a `bluetemberg.config.json` manually with an `extends` field pointing to the shared source:

```json
{
  "platforms": ["cursor", "claude"],
  "source": "llm",
  "extends": ["../../"]
}
```

See [Configuration](Configuration) for the full `extends` reference.

## 3. Add sync check to CI

Add to your GitHub Actions workflow to catch drift:

```yaml
- name: Check AI config sync
  run: npx bluetemberg sync --check
```

This step exits with code 1 if any platform-specific file (`.cursor/rules/`, `.claude/rules/`, `.github/instructions/`, `.cursor/mcp.json`, `.github/prompts/`, etc.) is out of sync with the source in `llm/` (and with optional `adapters` output, if you use them). It prevents the common pattern where someone edits a rule in `llm/` and forgets to run sync before pushing. Without this check, the AI tools on different platforms silently diverge.

## 4. Ongoing workflow

After editing any file in `llm/`, or after changing `platforms`, `extends`, or `adapters` in `bluetemberg.config.json`:

```bash
# Regenerate platform files
npm run sync:llm-config

# Verify in CI
npm run sync:llm-config:check
```

## Updating Bluetemberg

To get the latest starter templates and sync engine:

```bash
npm update @prototypdigital/bluetemberg
```

Then re-run sync to pick up any engine changes:

```bash
npx bluetemberg sync
```

## Migrating from manual setup

If your project already has AI config files (`.cursor/rules/`, `.claude/rules/`, etc.) that were created manually:

1. Run `npx @prototypdigital/bluetemberg init` in your project
2. Move your existing rule content into `llm/rules/` with the correct frontmatter format
3. Run `npx bluetemberg sync` to regenerate platform files
4. Verify the output matches your previous setup
5. Delete any manually-created platform files that are now generated
