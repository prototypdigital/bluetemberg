import { readFileSync, existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { RULE_COLLECTION_PRESETS, MARKETPLACE_PLUGIN_PACKS } from './presets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

export function scaffold(targetDir: string, answers: InitAnswers): string[] {
  const created: string[] = [];

  scaffoldConfig(targetDir, answers, created);

  if (answers.ruleSource === 'collections') {
    scaffoldRuleCollections(targetDir, answers, created);
  } else {
    scaffoldRules(targetDir, answers, created);
  }

  if (answers.includeAgents) {
    scaffoldAgents(targetDir, answers, created);
  }

  if (answers.includeSkills) {
    scaffoldSkills(targetDir, answers, created);
  }

  scaffoldRootDocs(targetDir, answers, created);

  if (answers.includeMcp) {
    scaffoldMcp(targetDir, answers, created);
  }

  if (answers.platforms.includes('claude-marketplace')) {
    scaffoldMarketplaceWorkflow(targetDir, created);
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
    targets,
    ...(answers.platforms.includes(MARKETPLACE_PLATFORM)
      ? { marketplace: buildMarketplaceConfig(answers) }
      : {}),
    ...(existingAdapters !== undefined ? { adapters: existingAdapters } : {}),
  };

  safeWrite(configPath, JSON.stringify(config, null, 2) + '\n', created);
}

function scaffoldRules(targetDir: string, answers: InitAnswers, created: string[]): void {
  const destDir = join(targetDir, 'llm', 'rules');
  ensureDir(destDir);

  for (const ruleId of answers.rules) {
    const src = join(TEMPLATES_DIR, 'rules', `${ruleId}.md`);
    if (!existsSync(src)) {
      console.warn(`  Warning: rule template "${ruleId}" not found, skipping`);
      continue;
    }

    const dest = join(destDir, `${ruleId}.md`);
    copyFileSync(src, dest);
    created.push(dest);
  }
}

function scaffoldRuleCollections(targetDir: string, answers: InitAnswers, created: string[]): void {
  if (answers.ruleCollections.length === 0) return;

  const packages: Record<string, string> = {};
  for (const collectionId of answers.ruleCollections) {
    const preset = RULE_COLLECTION_PRESETS.find((c) => c.id === collectionId);
    if (!preset) continue;
    packages[preset.packageName] = '^0.1.0';
  }

  const manifest: PackageManifest = { packages };
  const manifestPath = join(targetDir, 'llm', 'rule-packages.json');
  ensureDir(dirname(manifestPath));
  safeWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n', created);
}

function scaffoldAgents(targetDir: string, answers: InitAnswers, created: string[]): void {
  const destDir = join(targetDir, 'llm', 'agents');
  ensureDir(destDir);

  for (const agentId of answers.agents) {
    const src = join(TEMPLATES_DIR, 'agents', `${agentId}.md`);
    if (!existsSync(src)) {
      console.warn(`  Warning: agent template "${agentId}" not found, skipping`);
      continue;
    }

    const dest = join(destDir, `${agentId}.md`);
    copyFileSync(src, dest);
    created.push(dest);
  }
}

function scaffoldSkills(targetDir: string, answers: InitAnswers, created: string[]): void {
  ensureDir(join(targetDir, 'llm', 'skills'));

  for (const skillId of answers.skills) {
    const src = join(TEMPLATES_DIR, 'skills', skillId, 'SKILL.md');
    if (!existsSync(src)) {
      console.warn(`  Warning: skill template "${skillId}" not found, skipping`);
      continue;
    }

    const destDir = join(targetDir, 'llm', 'skills', skillId);
    ensureDir(destDir);
    const dest = join(destDir, 'SKILL.md');
    copyFileSync(src, dest);
    created.push(dest);
  }
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
    `Run \`${pm} sync:llm-config\` to generate tool-specific files in ${targetDirs.join(', ')}. These generated files should not be edited directly.`,
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
    const syncCmd = `${pm} sync:llm-config`;
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

function scaffoldMarketplaceWorkflow(targetDir: string, created: string[]): void {
  const src = join(TEMPLATES_DIR, 'ci', 'sync-marketplace.yml');
  if (!existsSync(src)) return;

  const dest = join(targetDir, '.github', 'workflows', 'sync-marketplace.yml');
  ensureDir(dirname(dest));
  copyFileSync(src, dest);
  created.push(dest);
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
