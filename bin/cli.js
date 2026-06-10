#!/usr/bin/env node

import { program } from 'commander';
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

const { INIT_TEAM_PROFILES, INIT_PACKAGE_MANAGERS, INIT_PLATFORMS, INIT_RULE_SOURCES } =
  await import('../dist/init/init-catalog.js');

const TEAM_PROFILES = new Set(INIT_TEAM_PROFILES);
const PLATFORMS = new Set(INIT_PLATFORMS);
const PACKAGE_MANAGERS = new Set(INIT_PACKAGE_MANAGERS);
const RULE_SOURCES = new Set(INIT_RULE_SOURCES);

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
function straySilentRequiresNiOrConfig(opts) {
  if (!argvHas('--silent')) return null;
  if ((opts.nonInteractive || opts.config) ?? false) return null;
  return 'Init `--silent` requires `--non-interactive` or `--config`';
}

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
  checkCsv(opts.sources, '`--sources`');
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
  checkBundle(opts.sources, '--sources');
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
    return '--rule-source must be templates, collections, or none.';
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

  if ((opts.sources ?? '') !== '') ov.externalSources = csvList(String(opts.sources));

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
  .option('--silent', 'Suppress progress output (requires --non-interactive or --config)')
  .option('--config <file>', 'Init answers JSON (InitAnswers shape); exclusive with override flags')
  .option('--profile <id>', 'Team profile (same ids as wizard; `--non-interactive` default fullstack)')
  .option('--project-name <name>')
  .option('--project-description <text>')
  .option('--package-manager <id>', 'pnpm | npm | yarn')
  .option('--platforms <csv>', 'Comma-separated platforms (e.g. cursor,claude)')
  .option('--rule-source <mode>', 'templates | collections | none')
  .option(
    '--rules <csv>',
    'Template rule ids (profile universal rules are always merged; pure-infra omits app-code universals)',
  )
  .option('--rule-collections <csv>', 'Collections when `--rule-source collections`')
  .option('--agents <csv>')
  .option('--skills <csv>')
  .option('--mcp-servers <csv>')
  .option('--sources <csv>', 'External source specs (comma-separated, e.g. "github:owner/repo#HEAD:rules")')
  .option('--omit-agents')
  .option('--omit-skills')
  .option('--omit-mcp')
  .action(async (directory, options) => {
    const msgSilent = straySilentRequiresNiOrConfig(options);
    if (msgSilent) {
      console.error(`${msgSilent}.`);
      process.exit(1);
    }

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

    if (options.silent) {
      initRunOpts.silent = true;
    }

    const { init } = await import('../dist/init/index.js');
    try {
      await init(resolve(directory), initRunOpts);
    } catch (err) {
      if (!options.silent) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
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
  .command('switch-profile')
  .description('Switch the project to a different team profile (non-destructive)')
  .argument('<profile>', `New profile id (one of: ${[...TEAM_PROFILES].join(', ')})`)
  .argument('[directory]', 'Project root directory', '.')
  .option('--silent', 'Suppress output')
  .action(async (profile, directory, options) => {
    if (!TEAM_PROFILES.has(profile)) {
      console.error(`Unknown profile "${profile}". Expected one of: ${[...TEAM_PROFILES].join(', ')}`);
      process.exit(1);
    }

    const { switchProfile } = await import('../dist/init/switch-profile.js');
    try {
      const result = switchProfile(resolve(directory), profile, { silent: options.silent });
      void result;
    } catch (err) {
      if (!options.silent) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
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

const sourceCmd = program
  .command('source')
  .description('Manage external rule sources (GitHub repos, PRPM, cursor.directory)');

sourceCmd
  .command('add')
  .description('Add an external source (e.g. "github:PatrickJS/awesome-cursorrules#HEAD:rules")')
  .argument(
    '<spec>',
    'Source spec: github:owner/repo[#ref][:path] | prpm:name[@range] | cursor-directory:slug',
  )
  .option('--silent', 'Suppress all output')
  .action(async (spec, options) => {
    const { addSource } = await import('../dist/sources/registry.js');
    try {
      await addSource(process.cwd(), spec, { silent: options.silent });
    } catch (err) {
      if (!options.silent) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  });

sourceCmd
  .command('remove')
  .description('Remove an external source by key')
  .argument('<key>', 'Source key (as shown by "bluetemberg source list")')
  .option('--silent', 'Suppress all output')
  .action(async (key, options) => {
    const { removeSource } = await import('../dist/sources/registry.js');
    try {
      removeSource(process.cwd(), key, { silent: options.silent });
    } catch (err) {
      if (!options.silent) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  });

sourceCmd
  .command('list')
  .description('List configured external sources')
  .option('--silent', 'Suppress all output')
  .action(async (options) => {
    const { listSources } = await import('../dist/sources/registry.js');
    try {
      listSources(process.cwd(), { silent: options.silent });
    } catch (err) {
      if (!options.silent) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  });

sourceCmd
  .command('install')
  .description('Install all external sources from the manifest (like npm ci)')
  .option('--force', 'Force re-download even if cached')
  .option('--silent', 'Suppress all output')
  .action(async (options) => {
    const { installSources } = await import('../dist/sources/registry.js');
    try {
      await installSources(process.cwd(), { force: options.force, silent: options.silent });
    } catch (err) {
      if (!options.silent) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  });

sourceCmd
  .command('update')
  .description('Re-resolve external sources to the newest ref/version satisfying their spec')
  .argument('[key]', 'Source key to update (updates all when omitted)')
  .option('--silent', 'Suppress all output')
  .action(async (key, options) => {
    const { updateSources } = await import('../dist/sources/registry.js');
    try {
      await updateSources(process.cwd(), key, { silent: options.silent });
    } catch (err) {
      if (!options.silent) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  });

sourceCmd
  .command('search')
  .description('Search external sources that support discovery (PRPM, cursor.directory)')
  .argument('<query>', 'Search query')
  .option('--type <type>', 'Restrict to one backend: prpm | cursor-directory')
  .option('--limit <n>', 'Max results (default: 20)', (s) => parseInt(s, 10))
  .option('--silent', 'Suppress all output')
  .action(async (query, options) => {
    const { searchSources } = await import('../dist/sources/registry.js');
    try {
      await searchSources(query, { type: options.type, limit: options.limit, silent: options.silent });
    } catch (err) {
      if (!options.silent) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  });

program.parse();
