import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import matter from 'gray-matter';
import { transformFrontmatter, DEFAULT_TARGETS } from './transform.js';
import { ensureDir, writeOrCheck, listFiles, listDirs } from '../utils/fs.js';
import type {
  Platform,
  BlueprintConfig,
  SyncOptions,
  SyncResults,
  TargetConfig,
  SkillTargetConfig,
} from '../types.js';

export function loadConfig(root: string): BlueprintConfig {
  const configPath = join(root, 'bluetemberg.config.json');

  if (existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, 'utf8')) as BlueprintConfig;
  }

  return {
    platforms: ['cursor', 'claude', 'copilot'],
    source: 'llm',
    targets: DEFAULT_TARGETS,
  };
}

function filterTargets<T>(targets: Partial<Record<Platform, T>>, platforms: Platform[]): [Platform, T][] {
  return Object.entries(targets)
    .filter(([platform]) => platforms.includes(platform as Platform))
    .map(([platform, config]) => [platform as Platform, config as T]);
}

interface SyncContext {
  root: string;
  sourceBase: string;
  config: BlueprintConfig;
  platforms: Platform[];
  checkMode: boolean;
  results: SyncResults;
  log: (...args: unknown[]) => void;
}

export function sync(root: string, options: SyncOptions = {}): SyncResults {
  const checkMode = options.check || false;
  const config = options.config || loadConfig(root);
  const platforms = config.platforms || ['cursor', 'claude', 'copilot'];
  const sourceBase = join(root, config.source || 'llm');

  const results: SyncResults = { synced: 0, outOfSync: 0, errors: [] };
  const log = options.silent ? () => {} : console.log;

  log(checkMode ? 'Checking sync status...\n' : 'Syncing AI config...\n');

  const ctx: SyncContext = {
    root,
    sourceBase,
    config,
    platforms,
    checkMode,
    results,
    log,
  };

  syncRules(ctx);
  syncAgents(ctx);
  syncSkills(ctx);
  syncCopilotInstructions(ctx);

  if (checkMode) {
    if (results.outOfSync > 0) {
      log(`\n${results.outOfSync} file(s) out of sync. Run: npx bluetemberg sync`);
    } else {
      log('\nAll files in sync.');
    }
  } else {
    log(`\nDone. ${results.synced} file(s) written.`);
  }

  return results;
}

function syncRules(ctx: SyncContext): void {
  const sourceDir = join(ctx.sourceBase, 'rules');
  const files = listFiles(sourceDir, (f) => f.endsWith('.md'));
  if (files.length === 0) return;

  ctx.log(`Rules: ${files.length} source files`);
  const ruleTargets = filterTargets<TargetConfig>(
    ctx.config.targets?.rules || DEFAULT_TARGETS.rules,
    ctx.platforms,
  );

  for (const [platform, targetConfig] of ruleTargets) {
    const outDir = join(ctx.root, targetConfig.dir);
    ensureDir(outDir);

    for (const file of files) {
      const source = matter.read(join(sourceDir, file));
      const transformed = transformFrontmatter(source.data, platform);
      const output = matter.stringify(source.content, transformed);
      const outName = file.replace(/\.md$/, targetConfig.ext);
      const outPath = join(outDir, outName);

      const isDiff = writeOrCheck(outPath, output, ctx.checkMode);
      if (ctx.checkMode && isDiff) {
        ctx.log(`  OUT OF SYNC: ${relative(ctx.root, outPath)}`);
        ctx.results.outOfSync++;
      } else if (!ctx.checkMode) {
        ctx.results.synced++;
      }
    }

    if (!ctx.checkMode) ctx.log(`  -> ${targetConfig.dir}/ (${files.length} files)`);
  }
}

function syncAgents(ctx: SyncContext): void {
  const sourceDir = join(ctx.sourceBase, 'agents');
  const files = listFiles(sourceDir, (f) => f.endsWith('.md') && f !== 'README.md');
  if (files.length === 0) return;

  ctx.log(`Agents: ${files.length} source files`);
  const agentTargets = filterTargets<TargetConfig>(
    ctx.config.targets?.agents || DEFAULT_TARGETS.agents,
    ctx.platforms,
  );

  for (const [, targetConfig] of agentTargets) {
    const outDir = join(ctx.root, targetConfig.dir);
    ensureDir(outDir);

    for (const file of files) {
      const content = readFileSync(join(sourceDir, file), 'utf8');
      const outName = file.replace(/\.md$/, targetConfig.ext);
      const outPath = join(outDir, outName);

      const isDiff = writeOrCheck(outPath, content, ctx.checkMode);
      if (ctx.checkMode && isDiff) {
        ctx.log(`  OUT OF SYNC: ${relative(ctx.root, outPath)}`);
        ctx.results.outOfSync++;
      } else if (!ctx.checkMode) {
        ctx.results.synced++;
      }
    }

    if (!ctx.checkMode) ctx.log(`  -> ${targetConfig.dir}/ (${files.length} files)`);
  }
}

function syncSkills(ctx: SyncContext): void {
  const sourceDir = join(ctx.sourceBase, 'skills');
  const dirs = listDirs(sourceDir);
  if (dirs.length === 0) return;

  ctx.log(`Skills: ${dirs.length} source directories`);
  const skillTargets = filterTargets<SkillTargetConfig>(
    ctx.config.targets?.skills || DEFAULT_TARGETS.skills,
    ctx.platforms,
  );

  for (const [, targetConfig] of skillTargets) {
    for (const dirName of dirs) {
      const srcSkill = join(sourceDir, dirName, 'SKILL.md');
      if (!existsSync(srcSkill)) continue;

      const outDir = join(ctx.root, targetConfig.dir, dirName);
      ensureDir(outDir);

      const content = readFileSync(srcSkill, 'utf8');
      const outPath = join(outDir, 'SKILL.md');

      const isDiff = writeOrCheck(outPath, content, ctx.checkMode);
      if (ctx.checkMode && isDiff) {
        ctx.log(`  OUT OF SYNC: ${relative(ctx.root, outPath)}`);
        ctx.results.outOfSync++;
      } else if (!ctx.checkMode) {
        ctx.results.synced++;
      }
    }

    if (!ctx.checkMode) ctx.log(`  -> ${targetConfig.dir}/ (${dirs.length} skills)`);
  }
}

function syncCopilotInstructions(ctx: SyncContext): void {
  const agentsMd = join(ctx.root, 'AGENTS.md');
  if (!existsSync(agentsMd)) return;

  const target = join(ctx.root, '.github', 'copilot-instructions.md');
  ensureDir(join(ctx.root, '.github'));
  const content = readFileSync(agentsMd, 'utf8');

  const isDiff = writeOrCheck(target, content, ctx.checkMode);
  if (ctx.checkMode && isDiff) {
    ctx.log(`  OUT OF SYNC: ${relative(ctx.root, target)}`);
    ctx.results.outOfSync++;
  } else if (!ctx.checkMode) {
    ctx.results.synced++;
    ctx.log('Copilot instructions: synced from AGENTS.md');
  }
}
