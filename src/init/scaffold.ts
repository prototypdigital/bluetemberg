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
} from '../types.js';
import { parseSourceSpec, sourceKey } from '../sources/spec.js';
import type { SourceManifest } from '../sources/types.js';
import { DEFAULT_PACK_VERSION } from '../registry/manifest.js';
import {
  RULE_COLLECTION_OVERLAYS,
  AGENT_OVERLAYS,
  SKILL_OVERLAYS,
  GUARDRAIL_PRESETS,
  MARKETPLACE_PLUGIN_PACKS,
} from './presets.js';

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
    ...(answers.stacks && Object.keys(answers.stacks).length > 0 ? { stacks: answers.stacks } : {}),
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
      const preset = RULE_COLLECTION_OVERLAYS.find((c) => c.id === collectionId);
      if (!preset) continue;
      packages[preset.packageName] = DEFAULT_PACK_VERSION;
    }
  }

  if (answers.includeAgents) {
    for (const agentId of answers.agents) {
      const preset = AGENT_OVERLAYS.find((a) => a.id === agentId);
      if (!preset?.packageName) continue;
      packages[preset.packageName] = DEFAULT_PACK_VERSION;
    }
  }

  if (answers.includeSkills) {
    for (const skillId of answers.skills) {
      const preset = SKILL_OVERLAYS.find((s) => s.id === skillId);
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
  if (answers.platforms.includes('codex')) targetDirs.push('`AGENTS.md` + `.codex/`');
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

const CONTRIBUTING_TEMPLATE = `# Contributing

Thank you for your interest in contributing!

## Getting started

1. Fork the repository and clone it locally.
2. Install dependencies and run the test suite to verify your setup.
3. Create a branch following the \`type/short-description\` convention (e.g. \`feat/add-feature\`).

## Pull requests

- Keep changes focused — one concern per PR.
- PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/): \`type(scope): description\`.
- All checks must pass before merge.

## Reporting issues

Use the issue templates in this repository. Include steps to reproduce, expected behaviour, and actual behaviour.
`;

const LICENSE_TEMPLATE = `MIT License

Copyright (c) [year] [fullname]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const CODE_OF_CONDUCT_TEMPLATE = `# Contributor Covenant Code of Conduct

## Our Pledge

We as members, contributors, and leaders pledge to make participation in our
community a welcoming experience for everyone, regardless of age, body size,
visible or invisible disability, ethnicity, sex characteristics, gender identity
and expression, level of experience, education, socio-economic status,
nationality, personal appearance, race, caste, color, religion, or sexual
identity and orientation.

We pledge to act and interact in ways that contribute to an open, welcoming,
diverse, inclusive, and healthy community.

## Our Standards

Examples of behavior that contributes to a positive environment:

* Demonstrating empathy and kindness toward other people
* Being respectful of differing opinions, viewpoints, and experiences
* Giving and gracefully accepting constructive feedback
* Accepting responsibility and apologizing to those affected by our mistakes
* Focusing on what is best not just for us as individuals, but for the community

## Enforcement

Instances of abusive, threatening, or otherwise unacceptable behavior may be
reported to the community leaders responsible for enforcement at:
**[INSERT ENFORCEMENT CONTACT — e.g. conduct@example.com or a GitHub issue link]**

All complaints will be reviewed and investigated promptly and fairly.

## Attribution

This Code of Conduct is adapted from the [Contributor Covenant](https://www.contributor-covenant.org),
version 2.1, available at https://www.contributor-covenant.org/version/2/1/code_of_conduct.html.
`;

const SECURITY_TEMPLATE = `# Security Policy

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Report vulnerabilities privately via [GitHub Security Advisories](../../security/advisories/new).
You will receive a response within 7 days. If the issue is confirmed, a patch will be released
as soon as possible.

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | ✓         |
`;

function scaffoldGitHub(targetDir: string, answers: InitAnswers, created: string[]): void {
  const cfg = answers.github;
  if (!cfg) return;

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
  if (cfg.contributing) {
    safeWrite(join(targetDir, 'CONTRIBUTING.md'), CONTRIBUTING_TEMPLATE, created);
  }
  if (cfg.license) {
    safeWrite(join(targetDir, 'LICENSE'), LICENSE_TEMPLATE, created);
  }
  if (cfg.codeOfConduct) {
    safeWrite(join(targetDir, 'CODE_OF_CONDUCT.md'), CODE_OF_CONDUCT_TEMPLATE, created);
  }
  if (cfg.security) {
    safeWrite(join(targetDir, 'SECURITY.md'), SECURITY_TEMPLATE, created);
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
