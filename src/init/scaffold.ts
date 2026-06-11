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
import { parseSourceSpec, sourceKey } from '../sources/spec.js';
import type { SourceManifest } from '../sources/types.js';
import { DEFAULT_PACK_VERSION } from '../registry/manifest.js';
import {
  RULE_COLLECTION_PRESETS,
  AGENT_PRESETS,
  SKILL_PRESETS,
  MARKETPLACE_PLUGIN_PACKS,
} from './presets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

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

  if (answers.platforms.includes('claude-marketplace')) {
    scaffoldMarketplaceWorkflow(targetDir, created);
  }

  if (answers.platforms.includes('claude')) {
    scaffoldClaudeSettings(targetDir, created);
  }

  if (answers.includeGuardrails !== false && (answers.guardrails?.length ?? 0) > 0) {
    scaffoldGuardrails(targetDir, answers.guardrails!, created);
  }

  if ((answers.externalSources?.length ?? 0) > 0) {
    scaffoldSources(targetDir, answers.externalSources!, created);
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

function scaffoldGuardrails(targetDir: string, guardrailIds: string[], created: string[]): void {
  const destDir = join(targetDir, 'llm', 'guardrails');
  ensureDir(destDir);

  for (const id of guardrailIds) {
    const src = join(TEMPLATES_DIR, 'guardrails', `${id}.md`);
    if (!existsSync(src)) {
      console.warn(`  Warning: guardrail template "${id}" not found, skipping`);
      continue;
    }
    const dest = join(destDir, `${id}.md`);
    copyFileSync(src, dest);
    created.push(dest);
  }
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

function scaffoldMarketplaceWorkflow(targetDir: string, created: string[]): void {
  const src = join(TEMPLATES_DIR, 'ci', 'sync-marketplace.yml');
  if (!existsSync(src)) return;

  const dest = join(targetDir, '.github', 'workflows', 'sync-marketplace.yml');
  ensureDir(dirname(dest));
  copyFileSync(src, dest);
  created.push(dest);
}

const ENTER_WORKTREE_NAMING_HOOK =
  `bash -c 'name=$(cat | jq -r ".name // empty" 2>/dev/null); ` +
  `if [[ -z "$name" || "$name" == claude/* ]]; then ` +
  `echo "EnterWorktree requires a conventional branch name. ` +
  `Call EnterWorktree again with name=\\"type/description\\" (e.g. feat/my-feature). ` +
  `Ask the user what the branch should be called if unclear. ` +
  `Types: feat fix chore refactor docs test"; exit 2; fi'`;

function scaffoldClaudeSettings(targetDir: string, created: string[]): void {
  const settingsPath = join(targetDir, '.claude', 'settings.json');

  let settings: Record<string, unknown> = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
  };

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    } catch {
      // corrupt — overwrite
    }
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const preToolUse = (hooks.PreToolUse ?? []) as Array<Record<string, unknown>>;

  const alreadyHasHook = preToolUse.some(
    (entry) =>
      entry.matcher === 'EnterWorktree' &&
      Array.isArray(entry.hooks) &&
      (entry.hooks as Array<Record<string, unknown>>).some((h) =>
        String(h.command ?? '').includes('claude/*'),
      ),
  );

  if (!alreadyHasHook) {
    preToolUse.unshift({
      matcher: 'EnterWorktree',
      hooks: [{ type: 'command', command: ENTER_WORKTREE_NAMING_HOOK }],
    });
    hooks.PreToolUse = preToolUse;
    settings.hooks = hooks;
    safeWrite(settingsPath, JSON.stringify(settings, null, 2) + '\n', created);
  }
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
