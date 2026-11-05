# Consumer Setup

How to set up a downstream project to use Bluetemberg. For the shortest path with expected output, see the [Quickstart](Quickstart).

## 1. Initialize and install

```bash
npx bluetemberg init
npx bluetemberg install
npx bluetemberg sync
```

Follow the interactive prompts to select platforms, rules, agents, and skills. Available platforms: **Cursor**, **Claude Code**, **GitHub Copilot**, **Gemini CLI (Enterprise)**, **Antigravity CLI**, **Devin Desktop (formerly Windsurf)**, **OpenAI Codex**. Two more options, unchecked by default, publish plugin bundles instead of configuring a tool: **Claude Code Marketplace** and **Agent Plugins 1.0** (see [Marketplace](Marketplace)).

`init` writes the pack list to `llm/packages.json` but does not download the packs; its first sync warns once per pack that it has no lockfile entry. `install` downloads and verifies them, and the second `sync` writes the platform files. Headless: `npx bluetemberg init --non-interactive --profile <id> --platforms <csv>` (see [Commands](Commands#bluetemberg-init-directory)).

**Monorepo or shared rule packs?** Skip `init` on child packages — instead create a `bluetemberg.config.json` manually with an `extends` field pointing to the shared source:

```json
{
  "platforms": ["cursor", "claude"],
  "source": "llm",
  "extends": ["../../"]
}
```

An entry can also be limited to some platforms, `{ "path": "../../", "platforms": ["claude"] }`. See [Configuration](Configuration) for the full `extends` reference.

**Claude Code:** keep the `@AGENTS.md` line at the top of the scaffolded `CLAUDE.md`. Claude Code reads `AGENTS.md` on its own only when no `CLAUDE.md` or `CLAUDE.local.md` exists, so removing the import hides `AGENTS.md` from Claude. `bluetemberg sync` warns if that happens. To load both files regardless, set **Project instructions** to `claude-md-and-agents-md` in Claude Code's `/config`. This is a per-user setting that a committed `.claude/settings.json` cannot change. See [Architecture](Architecture#claude-code-and-agentsmd).

## 2. GitHub repository files

The `bluetemberg init` wizard asks which GitHub repository files to scaffold; headless runs (`--non-interactive`) write all of them unless you pass `--omit-github`. A file that already exists is kept, not overwritten (`--force` replaces it). Select the ones that fit your project:

| Feature | File(s) | Default |
|---|---|---|
| Dependabot | `.github/dependabot.yml` | ✓ |
| Issue templates | `.github/ISSUE_TEMPLATE/*.yml` | ✓ |
| PR template | `.github/pull_request_template.md` | ✓ |
| CODEOWNERS | `.github/CODEOWNERS` | ✓ |
| CONTRIBUTING.md | `CONTRIBUTING.md` | ✓ |
| LICENSE | `LICENSE` | ✓ |
| CODE_OF_CONDUCT.md | `CODE_OF_CONDUCT.md` | ✓ |
| SECURITY.md | `SECURITY.md` | ✓ |

Bluetemberg never writes CI/CD workflows (`.github/workflows/`): your pipeline stays yours.

**After init, customize these files** — replace `@owner` in `CODEOWNERS` with your GitHub username or team. In `LICENSE`, replace `[year]` and `[fullname]` with the current year and your name or organization. In `CODE_OF_CONDUCT.md`, replace the enforcement contact placeholder with an actual email address or link.

## 3. Add sync check to CI (optional)

To catch drift in pull requests, add these steps to a workflow you own:

```yaml
- name: Install and verify packs
  run: |
    npx bluetemberg install
    npx bluetemberg verify
- name: Check AI config sync
  run: npx bluetemberg sync --check
```

`verify` re-checks every installed pack's integrity and registry signature.

This step exits with code 1 if any platform-specific file (`.cursor/rules/`, `.claude/rules/`, `.github/instructions/`, `.cursor/mcp.json`, `.github/prompts/`, etc.) is out of sync with the source in `llm/` (and with optional `adapters` output, if you use them). It prevents the common pattern where someone edits a rule in `llm/` and forgets to run sync before pushing. Without this check, the AI tools on different platforms silently diverge.

## 4. Ongoing workflow

After editing any file in `llm/`, or after changing `platforms`, `extends`, or `adapters` in `bluetemberg.config.json`:

```bash
# Regenerate platform files
npm run sync:llm-config

# Verify in CI
npm run sync:llm-config:check
```

To see why a rule is (or isn't) in the project, run `npx bluetemberg why <rule>`. Before a framework upgrade, `npx bluetemberg why --diff <stack@version>` lists what the upgrade would add or remove. Rule authors can run `npx bluetemberg stacks lint` to flag open-ended `stacks:` ranges.

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

## 7. Removing or ejecting

```bash
npx bluetemberg uninstall --dry-run   # what would be removed or edited
npx bluetemberg uninstall             # remove generated files and bluetemberg state, keep what you wrote
npx bluetemberg eject                 # keep the generated files as plain files you own, drop bluetemberg
```

See [Commands](Commands#bluetemberg-uninstall-directory) for exactly what each one removes and keeps.
