# Consumer Setup

How to set up a downstream project to use Bluetemberg.

## 1. Initialize

```bash
npx bluetemberg init
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

## 2. GitHub repository files

`bluetemberg init` asks whether to scaffold GitHub best-practice files for open source projects. All scaffolded features are free for public repositories. Select the ones that fit your project:

| Feature | File(s) | Default |
|---|---|---|
| CI workflow | `.github/workflows/ci.yml` | ✓ |
| CodeQL scanning | `.github/workflows/codeql.yml` | ✓ |
| Dependency review | `.github/workflows/dependency-review.yml` | ✓ |
| Dependabot | `.github/dependabot.yml` | ✓ |
| Issue templates | `.github/ISSUE_TEMPLATE/*.yml` | ✓ |
| PR template | `.github/pull_request_template.md` | ✓ |
| CODEOWNERS | `.github/CODEOWNERS` | ✓ |
| Release workflow | `.github/workflows/release.yml` | ✓ |
| CONTRIBUTING.md | `CONTRIBUTING.md` | ✓ |
| LICENSE | `LICENSE` | ✓ |
| CODE_OF_CONDUCT.md | `CODE_OF_CONDUCT.md` | ✓ |
| SECURITY.md | `SECURITY.md` | ✓ |
| Semantic PR check | `.github/workflows/semantic-pr.yml` | ✓ |
| Stale bot | `.github/workflows/stale.yml` | — |
| GitHub Pages | `.github/workflows/pages.yml` | — |
| Auto-labeler | `.github/workflows/label.yml`, `.github/labeler.yml` | — |
| Lock closed threads | `.github/workflows/lock-closed.yml` | — |

**After init, customize these files** — the CI workflow assumes `typecheck`, `lint`, and `test` scripts; the Pages workflow defaults to VitePress output at `docs/.vitepress/dist`. Update paths to match your project. Replace `@owner` in `CODEOWNERS` with your GitHub username or team.

## 3. Add sync check to CI

`bluetemberg init` scaffolds `.github/workflows/sync-check.yml`, which runs `bluetemberg sync --check` on pull requests that touch `llm/` or any generated output. If you set the project up without `init` (e.g. a monorepo child using `extends`), add the step yourself:

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

## 5. Updating Bluetemberg

To get the latest sync engine (pack content updates separately via `bluetemberg update`):

```bash
npm update bluetemberg
```

Then re-run sync to pick up any engine changes:

```bash
npx bluetemberg sync
```

## 6. Migrating from manual setup

If your project already has AI config files (`.cursor/rules/`, `.claude/rules/`, etc.) that were created manually:

1. Run `npx bluetemberg init` in your project
2. Move your existing rule content into `llm/rules/` with the correct frontmatter format
3. Run `npx bluetemberg sync` to regenerate platform files
4. Verify the output matches your previous setup
5. Delete any manually-created platform files that are now generated
