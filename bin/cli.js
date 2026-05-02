#!/usr/bin/env node

import { program, Option } from 'commander';
import { readFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const argvParts = process.argv.slice(2);
const wantsJsonHelp =
  argvParts.includes('--json') && (argvParts.includes('--help') || argvParts.includes('-h'));

if (wantsJsonHelp) {
  const { getMachineReadableHelp } = await import('../dist/help-json.js');
  /** stdout fd — avoid `process.exit` truncating piped output before drain */
  writeSync(1, `${JSON.stringify(getMachineReadableHelp(), null, 2)}\n`, 'utf8');
  process.exit(0);
}

const TEAM_PROFILES = new Set(['frontend', 'backend', 'fullstack', 'devops', 'pure-infra', 'custom']);
const PLATFORMS = new Set(['cursor', 'claude', 'copilot', 'gemini']);
const PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn']);
const RULE_SOURCES = new Set(['templates', 'collections']);

function argvHas(flag) {
  return argvParts.includes(flag);
}

function csvList(value) {
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @typedef {Record<string, unknown>} InitPartial */

/**
 * @param {unknown} opts
 */
function strayHeadlessOptsWithoutNiOrConfig(opts) {
  if ((opts.nonInteractive || opts.config) ?? false) return null;
  /** @type {string[]} */
  const found = [];

  const checkCsv = (
    /** @type {unknown} */
    val,
    /** @type {string} */
    label,
  ) => {
    if (val !== undefined && val !== '') found.push(label);
  };

  checkCsv(opts.profile, '`--profile`');
  checkCsv(opts.projectName, '`--project-name`');
  checkCsv(opts.projectDescription, '`--project-description`');
  checkCsv(opts.packageManager, '`--package-manager`');
  checkCsv(opts.platforms, '`--platforms`');
  checkCsv(opts.ruleSource, '`--rule-source`');
  checkCsv(opts.rules, '`--rules`');
  checkCsv(opts.ruleCollections, '`--rule-collections`');
  checkCsv(opts.agents, '`--agents`');
  checkCsv(opts.skills, '`--skills`');
  checkCsv(opts.mcpServers, '`--mcp-servers`');
  if (argvHas('--omit-agents')) found.push('--omit-agents');
  if (argvHas('--omit-skills')) found.push('--omit-skills');
  if (argvHas('--omit-mcp')) found.push('--omit-mcp');

  if (found.length === 0) return null;
  return `Init flags require \`--non-interactive\` or \`--config\`: ${found.join(', ')}`;
}

/** @param {unknown} opts */
function assertNoInitFlagsBundledWithConfig(opts) {
  if (!opts.config) return null;
  /** @type {string[]} */
  const found = [];

  if (opts.nonInteractive) found.push('--non-interactive');
  const checkBundle = (
    /** @type {unknown} */
    val,
    /** @type {string} */
    label,
  ) => {
    if (val !== undefined && val !== '') found.push(label);
  };

  checkBundle(opts.profile, '--profile');
  checkBundle(opts.projectName, '--project-name');
  checkBundle(opts.projectDescription, '--project-description');
  checkBundle(opts.packageManager, '--package-manager');
  checkBundle(opts.platforms, '--platforms');
  checkBundle(opts.ruleSource, '--rule-source');
  checkBundle(opts.rules, '--rules');
  checkBundle(opts.ruleCollections, '--rule-collections');
  checkBundle(opts.agents, '--agents');
  checkBundle(opts.skills, '--skills');
  checkBundle(opts.mcpServers, '--mcp-servers');
  if (argvHas('--omit-agents')) found.push('--omit-agents');
  if (argvHas('--omit-skills')) found.push('--omit-skills');
  if (argvHas('--omit-mcp')) found.push('--omit-mcp');

  if (found.length === 0) return null;
  return `Cannot combine \`--config\` with: ${found.join(', ')}`;
}

/** @param {unknown} opts */
function validateNonInteractiveValues(opts) {
  if (!(opts.nonInteractive ?? false)) return null;

  const profileUnknown =
    opts.profile !== undefined &&
    typeof opts.profile === 'string' &&
    opts.profile !== '' &&
    !TEAM_PROFILES.has(opts.profile);
  if (profileUnknown) {
    return `--profile must be one of ${[...TEAM_PROFILES].join(', ')}.`;
  }

  if (opts.profile !== undefined && typeof opts.profile === 'string' && opts.profile === '') {
    return '`--profile` cannot be empty when set.';
  }

  if (
    opts.packageManager !== undefined &&
    typeof opts.packageManager === 'string' &&
    !PACKAGE_MANAGERS.has(opts.packageManager)
  ) {
    return `--package-manager must be one of ${Array.from(PACKAGE_MANAGERS).join(', ')}.`;
  }

  if (opts.platforms !== undefined) {
    const pl = csvList(opts.platforms);
    if (pl.length === 0) {
      return '`--platforms` must list at least one id.';
    }
    if (pl.some((p) => !PLATFORMS.has(p))) {
      return `--platforms must be comma-separated from: ${Array.from(PLATFORMS).join(', ')}`;
    }
  }

  if (opts.ruleSource !== undefined && !RULE_SOURCES.has(opts.ruleSource)) {
    return '--rule-source must be templates or collections.';
  }

  return null;
}

/**
 * @param {unknown} opts
 * @returns {InitPartial}
 */
function buildNiOverrides(opts) {
  /** @type {InitPartial} */
  const ov = {};

  if (opts.projectName !== undefined) ov.projectName = opts.projectName;
  if (opts.projectDescription !== undefined) ov.projectDescription = opts.projectDescription;
  if (opts.packageManager !== undefined) ov.packageManager = opts.packageManager;
  if (opts.platforms !== undefined) ov.platforms = csvList(opts.platforms);
  if (opts.ruleSource !== undefined) ov.ruleSource = opts.ruleSource;

  if ((opts.rules ?? '') !== '') ov.rules = csvList(String(opts.rules));

  const ruleCollectionsRaw = opts.ruleCollections;
  if ((ruleCollectionsRaw ?? '') !== '') ov.ruleCollections = csvList(String(ruleCollectionsRaw));

  if ((opts.agents ?? '') !== '') ov.agents = csvList(String(opts.agents));

  if ((opts.skills ?? '') !== '') ov.skills = csvList(String(opts.skills));

  if ((opts.mcpServers ?? '') !== '') ov.mcpServers = csvList(String(opts.mcpServers));

  if (argvHas('--omit-agents')) ov.includeAgents = false;
  if (argvHas('--omit-skills')) ov.includeSkills = false;
  if (argvHas('--omit-mcp')) ov.includeMcp = false;

  return ov;
}

program
  .name('bluetemberg')
  .description('Scaffold and sync vendor-neutral AI tooling config')
  .version(pkg.version);

program
  .command('init')
  .description('Initialize AI tooling in a project')
  .argument('[directory]', 'Target directory', '.')
  .option('--non-interactive', 'Skip prompts — profile defaults plus optional overrides')
  .option('--config <file>', 'Init answers JSON (InitAnswers shape); exclusive with override flags')
  .option('--profile <id>', 'Team profile (same ids as wizard; `--non-interactive` default fullstack)')
  .option('--project-name <name>')
  .option('--project-description <text>')
  .addOption(new Option('--package-manager <id>', 'pnpm | npm | yarn').choices(Array.from(PACKAGE_MANAGERS)))
  .option('--platforms <csv>', 'Comma-separated platforms (e.g. cursor,claude)')
  .addOption(new Option('--rule-source <mode>').choices(Array.from(RULE_SOURCES)))
  .option('--rules <csv>', 'Template rule ids (universal rules are always enforced)')
  .option('--rule-collections <csv>', 'Collections when `--rule-source collections`')
  .option('--agents <csv>')
  .option('--skills <csv>')
  .option('--mcp-servers <csv>')
  .option('--omit-agents')
  .option('--omit-skills')
  .option('--omit-mcp')
  .action(async (directory, options) => {
    const msgExclusive = strayHeadlessOptsWithoutNiOrConfig(options);
    if (msgExclusive) {
      console.error(`${msgExclusive}.`);
      process.exit(1);
    }

    const msgConfigBundle = assertNoInitFlagsBundledWithConfig(options);
    if (msgConfigBundle) {
      console.error(msgConfigBundle);
      process.exit(1);
    }

    const msgNi = validateNonInteractiveValues(options);
    if (msgNi) {
      console.error(msgNi);
      process.exit(1);
    }

    const overrides = Boolean(options.nonInteractive) && !options.config ? buildNiOverrides(options) : {};

    /** @type {Record<string, unknown>} */
    const initRunOpts = {};

    if (typeof options.config === 'string' && options.config !== '') {
      initRunOpts.configPath = resolve(process.cwd(), options.config);
    }

    if (options.nonInteractive) {
      initRunOpts.nonInteractive = true;
      initRunOpts.profile =
        typeof options.profile === 'string' && options.profile.trim() !== '' ? options.profile : 'fullstack';

      if (Object.keys(overrides).length > 0) {
        initRunOpts.nonInteractiveOverrides = overrides;
      }
    }

    const { init } = await import('../dist/init/index.js');
    await init(resolve(directory), initRunOpts);
  });

program
  .command('sync')
  .description('Sync llm/ sources to platform-specific directories')
  .argument('[directory]', 'Project root directory', '.')
  .option('--check, --dry-run', 'Exit 1 if files are out of sync (no writes)')
  .option('--silent', 'Suppress all output')
  .option(
    '--prune',
    'After sync, remove stale generated files under managed output dirs (no-op with --check)',
  )
  .option('--verbose', 'Emit debug output: resolved source dirs, per-file origins, warnings')
  .action(async (directory, options) => {
    const { sync, loadConfig, shouldExitWithFailure } = await import('../dist/sync/index.js');
    const root = resolve(directory);

    let config;
    try {
      config = loadConfig(root);
    } catch (err) {
      if (!options.silent) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }

    const check = options.check || options.dryRun || false;
    const results = await sync(root, {
      check,
      config,
      silent: options.silent,
      prune: options.prune || false,
      verbose: options.verbose || false,
    });

    if (shouldExitWithFailure(results, check)) {
      process.exit(1);
    }
  });

program
  .command('add')
  .description('Add a rule pack from the npm registry')
  .argument('<package>', 'Package name with optional @version (e.g. my-rules@^1.0.0)')
  .option('--version <range>', 'Semver range (overrides @version in package spec)')
  .option('--silent', 'Suppress all output')
  .action(async (packageSpec, options) => {
    const { add } = await import('../dist/registry/index.js');
    try {
      await add(process.cwd(), packageSpec, {
        version: options.version,
        silent: options.silent,
      });
    } catch (err) {
      if (!options.silent) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  });

program
  .command('remove')
  .description('Remove a rule pack from the project')
  .argument('<package>', 'Package name to remove')
  .option('--silent', 'Suppress all output')
  .action(async (packageName, options) => {
    const { remove } = await import('../dist/registry/index.js');
    try {
      await remove(process.cwd(), packageName, { silent: options.silent });
    } catch (err) {
      if (!options.silent) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List installed rule packs')
  .option('--silent', 'Suppress all output')
  .action(async (options) => {
    const { list } = await import('../dist/registry/index.js');
    try {
      list(process.cwd(), { silent: options.silent });
    } catch (err) {
      if (!options.silent) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  });

program
  .command('install')
  .description('Install all rule packs from the manifest (like npm ci)')
  .option('--force', 'Force re-download even if cached')
  .option('--silent', 'Suppress all output')
  .action(async (options) => {
    const { install } = await import('../dist/registry/index.js');
    try {
      await install(process.cwd(), {
        force: options.force,
        silent: options.silent,
      });
    } catch (err) {
      if (!options.silent) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  });

program
  .command('update')
  .description('Update rule packs to the latest version satisfying their manifest range')
  .argument('[package]', 'Package name to update (updates all when omitted)')
  .option('--latest', 'Widen ranges to "latest" in manifest, not just re-resolve current range')
  .option('--silent', 'Suppress all output')
  .action(async (packageName, options) => {
    const { update } = await import('../dist/registry/index.js');
    try {
      await update(process.cwd(), packageName, {
        latest: options.latest,
        silent: options.silent,
      });
    } catch (err) {
      if (!options.silent) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search the npm registry for bluetemberg rule packs')
  .argument('<query>', 'Search query')
  .option('--limit <n>', 'Max results (default: 20)', (s) => parseInt(s, 10))
  .option('--silent', 'Suppress all output')
  .action(async (query, options) => {
    const { search } = await import('../dist/registry/index.js');
    try {
      await search(query, {
        limit: options.limit,
        silent: options.silent,
      });
    } catch (err) {
      if (!options.silent) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  });

program.parse();
