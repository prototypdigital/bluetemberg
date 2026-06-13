import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ensureDir } from '../utils/fs.js';
import { DEFAULT_TARGETS } from '../sync/transform.js';
import { MARKETPLACE_PLATFORM } from '../types.js';
import type {
  InitAnswers,
  BlueprintConfig,
  MarketplacePluginDefinition,
  Platform,
  TargetConfig,
  SkillTargetConfig,
  PackageManifest,
  PackageManager,
} from '../types.js';
import { parseSourceSpec, sourceKey } from '../sources/spec.js';
import type { SourceManifest } from '../sources/types.js';
import { DEFAULT_PACK_VERSION } from '../registry/manifest.js';
import {
  RULE_COLLECTION_PRESETS,
  AGENT_PRESETS,
  SKILL_PRESETS,
  GUARDRAIL_PRESETS,
  MARKETPLACE_PLUGIN_PACKS,
} from './presets.js';

/**
 * CI workflow written into every scaffolded project: fails the PR when
 * platform outputs drift from the `llm/` source. Inlined (rather than shipped
 * as a template file) so the npm package stays code-only.
 */
const SYNC_CHECK_WORKFLOW = `name: AI Config Sync Check

on:
  pull_request:
    paths:
      - 'llm/**'
      - '.cursor/rules/**'
      - '.claude/rules/**'
      - '.claude/agents/**'
      - '.claude/skills/**'
      - '.github/instructions/**'
      - '.github/agents/**'
      - '.github/skills/**'
      - 'AGENTS.md'
      - 'bluetemberg.config.json'

jobs:
  sync-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx -y bluetemberg sync --check
`;

/**
 * CI workflow for `claude-marketplace` projects: regenerates the plugin bundle
 * on pushes to main and mirrors it to the repo named by the MARKETPLACE_REPO
 * variable using the MARKETPLACE_PUSH_TOKEN secret.
 */
const SYNC_MARKETPLACE_WORKFLOW = `name: Sync Claude Marketplace

on:
  push:
    branches:
      - main
    paths:
      - 'llm/**'
      - 'bluetemberg.config.json'
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Generate marketplace output
        run: npx -y bluetemberg sync

      - name: Push to claude-marketplace repo
        env:
          MARKETPLACE_PUSH_TOKEN: \${{ secrets.MARKETPLACE_PUSH_TOKEN }}
        run: |
          git clone "https://x-access-token:\${MARKETPLACE_PUSH_TOKEN}@github.com/\${{ vars.MARKETPLACE_REPO }}.git" /tmp/marketplace

          # Abort if sync produced no output — do not wipe the marketplace with empty dirs
          if [ ! -d plugins ] || [ ! -d .claude-plugin ]; then
            echo "No marketplace output found — skipping push."
            exit 0
          fi

          rm -rf /tmp/marketplace/plugins /tmp/marketplace/.claude-plugin
          cp -r plugins /tmp/marketplace/plugins
          cp -r .claude-plugin /tmp/marketplace/.claude-plugin

          cd /tmp/marketplace
          git config user.name "bluetemberg-bot"
          git config user.email "bot@users.noreply.github.com"
          git add -A

          if git diff --cached --quiet; then
            echo "No changes to push."
          else
            git commit -m "sync: update from \${{ github.repository }}@\${{ github.sha }}"
            git push
          fi
`;

export function scaffold(targetDir: string, answers: InitAnswers): string[] {
  const created: string[] = [];

  scaffoldConfig(targetDir, answers, created);

  if (answers.ruleSource !== 'collections') {
    scaffoldEmptyRules(targetDir, created);
  }

  scaffoldPackageManifest(targetDir, answers, created);

  scaffoldRootDocs(targetDir, answers, created);

  if (answers.includeMcp) {
    scaffoldMcp(targetDir, answers, created);
  }

  scaffoldSyncCheckWorkflow(targetDir, created);

  if (answers.platforms.includes('claude-marketplace')) {
    scaffoldMarketplaceWorkflow(targetDir, created);
  }

  if ((answers.externalSources?.length ?? 0) > 0) {
    scaffoldSources(targetDir, answers.externalSources!, created);
  }

  if (answers.github) {
    scaffoldGitHub(targetDir, answers, created);
  }

  updatePackageScripts(targetDir, created);
  patchPrettierIgnore(targetDir, answers, created);

  return created;
}

function safeWrite(filePath: string, content: string, created: string[]): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, content);
  created.push(filePath);
}

function readExistingAdapters(configPath: string): string[] | undefined {
  if (!existsSync(configPath)) return undefined;
  try {
    const existing = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    if (Array.isArray(existing.adapters) && existing.adapters.every((a) => typeof a === 'string')) {
      return existing.adapters as string[];
    }
  } catch {
    // ignore — corrupt file will be overwritten
  }
  return undefined;
}

function buildMarketplacePlugins(answers: InitAnswers): MarketplacePluginDefinition[] {
  const packIds = answers.marketplacePlugins;
  if (!packIds || packIds.length === 0) {
    return [{ name: answers.projectName }];
  }
  return packIds.map((id) => {
    const pack = MARKETPLACE_PLUGIN_PACKS.find((p) => p.id === id);
    if (!pack) return { name: id };
    return {
      name: pack.id,
      displayName: pack.displayName,
      description: pack.description,
      profiles: pack.profiles,
    };
  });
}

function buildMarketplaceConfig(answers: InitAnswers): BlueprintConfig['marketplace'] {
  return {
    ...(answers.marketplaceRemote ? { remote: answers.marketplaceRemote } : {}),
    plugins: buildMarketplacePlugins(answers),
  };
}

function scaffoldConfig(targetDir: string, answers: InitAnswers, created: string[]): void {
  const targets: BlueprintConfig['targets'] = {};

  const hasRules = answers.rules.length > 0 || (answers.ruleCollections?.length ?? 0) > 0;
  if (hasRules) {
    targets.rules = {};
    for (const p of answers.platforms) {
      const t = DEFAULT_TARGETS.rules[p];
      if (t) (targets.rules as Record<Platform, TargetConfig>)[p] = t;
    }
  }

  if (answers.includeAgents && answers.agents.length > 0) {
    targets.agents = {};
    for (const p of answers.platforms) {
      const t = DEFAULT_TARGETS.agents[p];
      if (t) (targets.agents as Record<Platform, TargetConfig>)[p] = t;
    }
  }

  if (answers.includeSkills && answers.skills.length > 0) {
    targets.skills = {};
    for (const p of answers.platforms) {
      const t = DEFAULT_TARGETS.skills[p];
      if (t) (targets.skills as Record<Platform, SkillTargetConfig>)[p] = t;
    }
  }

  const configPath = join(targetDir, 'bluetemberg.config.json');
  const existingAdapters = readExistingAdapters(configPath);

  const config: BlueprintConfig = {
    platforms: answers.platforms,
    source: 'llm',
    ...(answers.teamProfile ? { profile: answers.teamProfile } : {}),
    targets,
    ...(answers.platforms.includes(MARKETPLACE_PLATFORM)
      ? { marketplace: buildMarketplaceConfig(answers) }
      : {}),
    ...(existingAdapters !== undefined ? { adapters: existingAdapters } : {}),
  };

  safeWrite(configPath, JSON.stringify(config, null, 2) + '\n', created);
}

/**
 * Empty rule source: create `llm/rules/` with a `.gitkeep` placeholder so the
 * otherwise-empty directory is committed for "bring your own rules" projects.
 * The placeholder is non-`.md`, so `sync` (which reads only `*.md`) ignores it.
 */
function scaffoldEmptyRules(targetDir: string, created: string[]): void {
  safeWrite(join(targetDir, 'llm', 'rules', '.gitkeep'), '', created);
}

function scaffoldPackageManifest(targetDir: string, answers: InitAnswers, created: string[]): void {
  const packages: Record<string, string> = {};

  if (answers.ruleSource === 'collections') {
    for (const collectionId of answers.ruleCollections) {
      const preset = RULE_COLLECTION_PRESETS.find((c) => c.id === collectionId);
      if (!preset) continue;
      packages[preset.packageName] = DEFAULT_PACK_VERSION;
    }
  }

  if (answers.includeAgents) {
    for (const agentId of answers.agents) {
      const preset = AGENT_PRESETS.find((a) => a.id === agentId);
      if (!preset?.packageName) continue;
      packages[preset.packageName] = DEFAULT_PACK_VERSION;
    }
  }

  if (answers.includeSkills) {
    for (const skillId of answers.skills) {
      const preset = SKILL_PRESETS.find((s) => s.id === skillId);
      if (!preset?.packageName) continue;
      packages[preset.packageName] = DEFAULT_PACK_VERSION;
    }
  }

  if (answers.includeGuardrails !== false) {
    for (const guardrailId of answers.guardrails ?? []) {
      const preset = GUARDRAIL_PRESETS.find((g) => g.id === guardrailId);
      if (!preset?.packageName) continue;
      packages[preset.packageName] = DEFAULT_PACK_VERSION;
    }
  }

  if (Object.keys(packages).length === 0) return;

  const manifest: PackageManifest = { packages };
  const manifestPath = join(targetDir, 'llm', 'packages.json');
  ensureDir(dirname(manifestPath));
  safeWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n', created);
}

function scaffoldRootDocs(targetDir: string, answers: InitAnswers, created: string[]): void {
  const pm = answers.packageManager === 'npm' ? 'npm run' : answers.packageManager;
  const desc = answers.projectDescription || `${answers.projectName} project.`;

  const agentsLines: string[] = [
    `# ${answers.projectName}`,
    '',
    desc,
    '',
    '## Commands',
    '',
    '```bash',
    `${pm} dev          # Start dev server`,
    `${pm} build        # Production build`,
    `${pm} lint:fix     # ESLint auto-fix`,
    `${pm} sync:llm-config   # Sync rules -> all AI tool directories`,
    '```',
    '',
    '## AI Config Architecture',
    '',
    'Source of truth for all AI tool configuration lives in `llm/`:',
    '',
    '- `llm/rules/` — scoped rules (frontmatter: `description`, `scope`)',
  ];

  if (answers.includeAgents) {
    agentsLines.push('- `llm/agents/` — specialist agent definitions');
  }
  if (answers.includeSkills) {
    agentsLines.push('- `llm/skills/` — on-demand skill workflows');
  }

  const targetDirs: string[] = [];
  if (answers.platforms.includes('cursor')) targetDirs.push('`.cursor/rules/`');
  if (answers.platforms.includes('claude')) targetDirs.push('`.claude/rules/`');
  if (answers.platforms.includes('copilot')) targetDirs.push('`.github/instructions/`');
  if (answers.platforms.includes('gemini')) targetDirs.push('`.gemini/context/`');
  if (answers.platforms.includes(MARKETPLACE_PLATFORM)) targetDirs.push('`plugins/`');

  agentsLines.push(
    '',
    `Run \`npx bluetemberg sync\` to generate tool-specific files in ${targetDirs.join(', ')}. These generated files should not be edited directly.`,
    '',
    '## Boundaries',
    '',
    '### Always',
    '',
    '- Run lint after editing code files',
    '- Follow existing patterns and conventions',
    '',
    '### Ask First',
    '',
    '- Adding new dependencies',
    '- Changing database schema or migrations',
    '',
    '### Never',
    '',
    '- Edit generated files (types, schemas)',
    '- Commit `.env` or secrets',
    '',
  );

  safeWrite(join(targetDir, 'AGENTS.md'), agentsLines.join('\n'), created);

  if (answers.platforms.includes('claude')) {
    const syncCmd = 'npx bluetemberg sync';
    const editDirs = ['`llm/rules/`'];
    if (answers.includeAgents) editDirs.push('`llm/agents/`');
    if (answers.includeSkills) editDirs.push('`llm/skills/`');

    const claudeLines: string[] = [
      '@AGENTS.md',
      '',
      '## Claude-Specific',
      '',
      'Rules, agents, and skills are synced from vendor-neutral source directories.',
      `After creating or editing files in ${editDirs.join(', ')}, run:`,
      '',
      '```bash',
      syncCmd,
      '```',
      '',
    ];

    safeWrite(join(targetDir, 'CLAUDE.md'), claudeLines.join('\n'), created);
  }
}

function scaffoldMcp(targetDir: string, answers: InitAnswers, created: string[]): void {
  const servers = answers.mcpServers;
  if (servers.length === 0) return;

  const llmDir = join(targetDir, 'llm');
  ensureDir(llmDir);
  const manifest = { servers };
  safeWrite(join(llmDir, 'mcp.json'), JSON.stringify(manifest, null, 2) + '\n', created);
}

function scaffoldSources(targetDir: string, specStrings: string[], created: string[]): void {
  const manifest: SourceManifest = { sources: {} };

  for (const raw of specStrings) {
    try {
      const spec = parseSourceSpec(raw);
      const key = sourceKey(spec);
      manifest.sources[key] = spec;
    } catch {
      console.warn(`  Warning: invalid source spec "${raw}", skipping`);
    }
  }

  if (Object.keys(manifest.sources).length === 0) return;

  const manifestPath = join(targetDir, 'llm', 'rule-sources.json');
  ensureDir(dirname(manifestPath));
  safeWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n', created);
}

function scaffoldSyncCheckWorkflow(targetDir: string, created: string[]): void {
  safeWrite(join(targetDir, '.github', 'workflows', 'sync-check.yml'), SYNC_CHECK_WORKFLOW, created);
}

function scaffoldMarketplaceWorkflow(targetDir: string, created: string[]): void {
  safeWrite(
    join(targetDir, '.github', 'workflows', 'sync-marketplace.yml'),
    SYNC_MARKETPLACE_WORKFLOW,
    created,
  );
}

function updatePackageScripts(targetDir: string, created: string[]): void {
  const pkgPath = join(targetDir, 'package.json');
  if (!existsSync(pkgPath)) return;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkg.scripts = pkg.scripts || {};
    pkg.scripts['sync:llm-config'] = 'npx bluetemberg sync';
    pkg.scripts['sync:llm-config:check'] = 'npx bluetemberg sync --check';
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    created.push(pkgPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  Warning: could not update package.json scripts: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// GitHub scaffolding
// ---------------------------------------------------------------------------

function ciInstallCmd(pm: PackageManager): string {
  if (pm === 'npm') return 'npm ci';
  if (pm === 'yarn') return 'yarn install --frozen-lockfile';
  return 'pnpm install --frozen-lockfile';
}

function ciRunCmd(pm: PackageManager, script: string): string {
  if (pm === 'npm') return script === 'test' ? 'npm test' : `npm run ${script}`;
  return `${pm} ${script}`;
}

function buildCiWorkflow(pm: PackageManager): string {
  const pnpmStep = pm === 'pnpm' ? `      - uses: pnpm/action-setup@v4\n` : '';
  return `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    name: CI
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${pnpmStep}      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: '${pm}'
      - run: ${ciInstallCmd(pm)}
      - run: ${ciRunCmd(pm, 'typecheck')}
      - run: ${ciRunCmd(pm, 'lint')}
      - run: ${ciRunCmd(pm, 'test')}
`;
}

const CODEQL_WORKFLOW = `name: CodeQL

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: '0 6 * * 1'

jobs:
  analyze:
    name: Analyze ($\{{ matrix.language }})
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      packages: read
      actions: read
      contents: read
    strategy:
      fail-fast: false
      matrix:
        include:
          - language: javascript-typescript
            build-mode: none
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: $\{{ matrix.language }}
          build-mode: $\{{ matrix.build-mode }}
      - uses: github/codeql-action/analyze@v3
        with:
          category: "/language:$\{{ matrix.language }}"
`;

const DEPENDENCY_REVIEW_WORKFLOW = `name: Dependency review

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  dependency-review:
    name: Dependency review
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
`;

const DEPENDABOT_CONFIG = `version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
`;

const BUG_REPORT_TEMPLATE = `name: Bug report
description: Report a reproducible bug
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: Thanks for taking the time to fill out this bug report!
  - type: textarea
    id: description
    attributes:
      label: Describe the bug
      description: A clear and concise description of what the bug is.
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      placeholder: |
        1. Run '...'
        2. See error
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
    validations:
      required: true
  - type: textarea
    id: environment
    attributes:
      label: Environment
      description: Node version, OS, package manager version, etc.
    validations:
      required: false
`;

const FEATURE_REQUEST_TEMPLATE = `name: Feature request
description: Suggest an idea or improvement
labels: ["enhancement"]
body:
  - type: markdown
    attributes:
      value: Thanks for suggesting an improvement!
  - type: textarea
    id: problem
    attributes:
      label: Problem to solve
      placeholder: I'm always frustrated when...
    validations:
      required: true
  - type: textarea
    id: solution
    attributes:
      label: Proposed solution
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
    validations:
      required: false
`;

const ISSUE_TEMPLATE_CONFIG = `blank_issues_enabled: false
contact_links: []
`;

const PR_TEMPLATE = `## Summary

<!-- Describe what this PR does and why. -->

## Changes

<!-- Bullet list of the main changes. -->

## Testing

- [ ] Tests pass
- [ ] Types check
- [ ] Lint passes
- [ ] Tested locally (for functional changes)

## Checklist

- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org/) (\`type(scope): description\`)
- [ ] Documentation updated if behavior changed
- [ ] No secrets or credentials committed
`;

const CODEOWNERS_TEMPLATE = `# CODEOWNERS
# https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners
#
# Replace @owner with your GitHub username or team (e.g. @myorg/team-name).
# Patterns are matched in order — last matching rule wins.

* @owner
`;

const RELEASE_WORKFLOW = `name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    name: Create release
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
`;

const STALE_WORKFLOW = `name: Mark stale

on:
  schedule:
    - cron: '0 1 * * *'
  workflow_dispatch:

permissions:
  issues: write
  pull-requests: write

jobs:
  stale:
    name: Mark stale issues and PRs
    runs-on: ubuntu-latest
    steps:
      - uses: actions/stale@v9
        with:
          days-before-stale: 60
          days-before-close: 14
          stale-issue-message: >
            This issue has been automatically marked as stale due to inactivity.
            It will be closed in 14 days unless there is new activity.
          stale-pr-message: >
            This PR has been automatically marked as stale due to inactivity.
            It will be closed in 14 days unless there is new activity.
          exempt-issue-labels: 'pinned,security'
          exempt-pr-labels: 'pinned,security'
`;

const CODERABBIT_CONFIG = `# yaml-language-server: $schema=https://coderabbit.ai/integrations/schema.v2.json
language: "en-US"
reviews:
  profile: "chill"
  request_changes_workflow: false
  high_level_summary: true
  poem: false
  auto_review:
    enabled: true
    drafts: false
chat:
  auto_reply: true
`;

function buildPagesWorkflow(pm: PackageManager): string {
  const pnpmStep = pm === 'pnpm' ? `      - uses: pnpm/action-setup@v4\n` : '';
  return `name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${pnpmStep}      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: '${pm}'
      - run: ${ciInstallCmd(pm)}
      # Adjust the build command and output path for your docs framework:
      # VitePress: docs:build → docs/.vitepress/dist
      # Docusaurus: build → build/
      # Astro Starlight: build → dist/
      - run: ${ciRunCmd(pm, 'docs:build')}
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist

  deploy:
    name: Deploy
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
`;
}

function scaffoldGitHub(targetDir: string, answers: InitAnswers, created: string[]): void {
  const cfg = answers.github;
  if (!cfg) return;

  const pm = answers.packageManager;

  if (cfg.ci) {
    safeWrite(join(targetDir, '.github', 'workflows', 'ci.yml'), buildCiWorkflow(pm), created);
  }
  if (cfg.codeql) {
    safeWrite(join(targetDir, '.github', 'workflows', 'codeql.yml'), CODEQL_WORKFLOW, created);
  }
  if (cfg.dependencyReview) {
    safeWrite(
      join(targetDir, '.github', 'workflows', 'dependency-review.yml'),
      DEPENDENCY_REVIEW_WORKFLOW,
      created,
    );
  }
  if (cfg.dependabot) {
    safeWrite(join(targetDir, '.github', 'dependabot.yml'), DEPENDABOT_CONFIG, created);
  }
  if (cfg.issueTemplates) {
    safeWrite(join(targetDir, '.github', 'ISSUE_TEMPLATE', 'bug_report.yml'), BUG_REPORT_TEMPLATE, created);
    safeWrite(
      join(targetDir, '.github', 'ISSUE_TEMPLATE', 'feature_request.yml'),
      FEATURE_REQUEST_TEMPLATE,
      created,
    );
    safeWrite(join(targetDir, '.github', 'ISSUE_TEMPLATE', 'config.yml'), ISSUE_TEMPLATE_CONFIG, created);
  }
  if (cfg.prTemplate) {
    safeWrite(join(targetDir, '.github', 'pull_request_template.md'), PR_TEMPLATE, created);
  }
  if (cfg.codeowners) {
    safeWrite(join(targetDir, '.github', 'CODEOWNERS'), CODEOWNERS_TEMPLATE, created);
  }
  if (cfg.releaseWorkflow) {
    safeWrite(join(targetDir, '.github', 'workflows', 'release.yml'), RELEASE_WORKFLOW, created);
  }
  if (cfg.staleBot) {
    safeWrite(join(targetDir, '.github', 'workflows', 'stale.yml'), STALE_WORKFLOW, created);
  }
  if (cfg.pagesWorkflow) {
    safeWrite(join(targetDir, '.github', 'workflows', 'pages.yml'), buildPagesWorkflow(pm), created);
  }
  if (cfg.coderabbit) {
    safeWrite(join(targetDir, '.coderabbit.yaml'), CODERABBIT_CONFIG, created);
  }
}

const BASE_PRETTIERIGNORE_ENTRIES = ['llm/', 'docs/wiki/'];
const MARKETPLACE_PRETTIERIGNORE_ENTRIES = ['plugins/'];

function patchPrettierIgnore(targetDir: string, answers: InitAnswers, created: string[]): void {
  const filePath = join(targetDir, '.prettierignore');
  let content = '';

  if (existsSync(filePath)) {
    content = readFileSync(filePath, 'utf8');
  }

  const entries = [
    ...BASE_PRETTIERIGNORE_ENTRIES,
    ...(answers.platforms.includes(MARKETPLACE_PLATFORM) ? MARKETPLACE_PRETTIERIGNORE_ENTRIES : []),
  ];

  const lines = content.split('\n');
  const missing = entries.filter((entry) => !lines.includes(entry));
  if (missing.length === 0) return;

  const suffix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  writeFileSync(filePath, content + suffix + missing.join('\n') + '\n');
  created.push(filePath);
}
