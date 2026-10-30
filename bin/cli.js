#!/usr/bin/env node

import { program, InvalidArgumentError } from 'commander';
import { readFileSync, statSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

// Fail early with a plain message instead of a stack trace from a missing `fetch` or syntax
// the runtime does not know. The check sits before the first `dist/` import for that reason.
const requiredNode = Number(
  String(pkg.engines?.node ?? '>=20')
    .replace(/[^0-9.]/g, '')
    .split('.')[0],
);
const runningNode = Number(process.versions.node.split('.')[0]);
if (Number.isFinite(requiredNode) && runningNode < requiredNode) {
  console.error(
    `bluetemberg needs Node.js ${pkg.engines?.node ?? '>=20'} (running ${process.version}). Upgrade Node and run the command again.`,
  );
  process.exit(1);
}

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
const { parseStacksCsv } = await import('../dist/init/stacks-csv.js');

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
  checkCsv(opts.stacks, '`--stacks`');
  if (argvHas('--omit-agents')) found.push('--omit-agents');
  if (argvHas('--omit-skills')) found.push('--omit-skills');
  if (argvHas('--omit-mcp')) found.push('--omit-mcp');
  if (argvHas('--omit-github')) found.push('--omit-github');

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
  checkBundle(opts.stacks, '--stacks');
  if (argvHas('--omit-agents')) found.push('--omit-agents');
  if (argvHas('--omit-skills')) found.push('--omit-skills');
  if (argvHas('--omit-mcp')) found.push('--omit-mcp');
  if (argvHas('--omit-github')) found.push('--omit-github');

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
    return '--rule-source must be collections or none.';
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

  // Template rules were retired; the flag is kept so existing scripts don't fail on an unknown option.
  if ((opts.rules ?? '') !== '') {
    console.warn(
      'Warning: `--rules` is deprecated and ignored (template rules were retired). Use `--rule-collections`.',
    );
  }

  const ruleCollectionsRaw = opts.ruleCollections;
  if ((ruleCollectionsRaw ?? '') !== '') ov.ruleCollections = csvList(String(ruleCollectionsRaw));

  if ((opts.agents ?? '') !== '') ov.agents = csvList(String(opts.agents));

  if ((opts.skills ?? '') !== '') ov.skills = csvList(String(opts.skills));

  if ((opts.mcpServers ?? '') !== '') ov.mcpServers = csvList(String(opts.mcpServers));

  if ((opts.sources ?? '') !== '') ov.externalSources = csvList(String(opts.sources));

  if ((opts.stacks ?? '') !== '') {
    const { stacks, skipped } = parseStacksCsv(String(opts.stacks));
    ov.stacks = stacks;
    if (skipped.length > 0 && !opts.silent) {
      console.error(
        `Warning: --stacks ignored ${skipped.length} token(s) with no stack name: ${skipped.join(', ')}. ` +
          'Use a short stack name like "angular", not a package name.',
      );
    }
  }

  if (argvHas('--omit-agents')) ov.includeAgents = false;
  if (argvHas('--omit-skills')) ov.includeSkills = false;
  if (argvHas('--omit-mcp')) ov.includeMcp = false;
  // Own property set to undefined: finalizeNonInteractiveAnswers keys off presence, not value.
  if (argvHas('--omit-github')) ov.github = undefined;

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
  .option('--rule-source <mode>', 'collections | none')
  .option('--rules <csv>', 'Deprecated and ignored (template rules were retired); use --rule-collections')
  .option('--rule-collections <csv>', 'Collections when `--rule-source collections`')
  .option('--agents <csv>')
  .option('--skills <csv>')
  .option('--mcp-servers <csv>')
  .option('--sources <csv>', 'External source specs (comma-separated, e.g. "github:owner/repo#HEAD:rules")')
  .option('--stacks <csv>', 'Stacks to manage (e.g. "payload@3.4.1,nextjs@auto"); bare name → "auto"')
  .option('--omit-agents')
  .option('--omit-skills')
  .option('--omit-mcp')
  .option('--omit-github', 'Skip the GitHub/community files (`--non-interactive` only)')
  .option('--force', 'Overwrite existing AGENTS.md, CLAUDE.md, and GitHub files instead of keeping them')
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

    if (options.force) {
      initRunOpts.force = true;
    }

    const { init } = await import('../dist/init/index.js');
    try {
      await init(resolve(directory), initRunOpts);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('Sync llm/ sources to platform-specific directories')
  .argument('[directory]', 'Project root directory', '.')
  .option('--check', 'Exit 1 if files are out of sync (no writes)')
  .option('--dry-run', 'Alias for --check')
  .option('--diff', 'With --check, print a per-file unified diff of what drifted (implies --check)')
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .option(
    '--prune',
    'After sync, remove stale generated files under managed output dirs (no-op with --check)',
  )
  .option('--verbose', 'Emit debug output: resolved source dirs, per-file origins, warnings')
  .option('--no-recursive', 'Sync only this directory; do not descend into configured workspace packages')
  .action(async (directory, options) => {
    const { sync, loadConfig, hasSyncConfig, shouldExitWithFailure } = await import('../dist/sync/index.js');
    const root = resolve(directory);

    if (!hasSyncConfig(root, options.recursive)) {
      console.error(
        `Error: No bluetemberg.config.json found for ${root}, so there is nothing to sync. Run \`bluetemberg init\` to set one up.`,
      );
      process.exit(1);
    }

    // Validate the local config early for a clean error + exit code. Sync (re)loads config per
    // package, so a recursive run picks up each workspace package's own merged config and stacks.
    try {
      loadConfig(root);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    // --diff implies --check: a diff is only meaningful when comparing against on-disk output.
    const check = options.check || options.dryRun || options.diff || false;
    if (options.diff && !options.check && !options.dryRun && !options.silent) {
      console.log('Note: --diff implies --check (no files will be written).');
    }
    const results = await sync(root, {
      check,
      silent: options.silent,
      prune: options.prune || false,
      verbose: options.verbose || false,
      diff: options.diff || false,
      recursive: options.recursive,
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
      const root = resolve(directory);
      const result = switchProfile(root, profile, { silent: options.silent });
      const { pinDefaultRanges } = await import('../dist/registry/default-ranges.js');
      await pinDefaultRanges(root, result.added);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/** One line per top-level path: hundreds of generated files read better as counts. */
function summarizePaths(paths) {
  const groups = new Map();
  for (const path of paths) {
    const parts = path.split(/[\\/]/);
    const key = parts.length > 2 ? `${parts[0]}/${parts[1]}/` : path;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups].map(([key, count]) => (count > 1 ? `${key} (${count} files)` : key));
}

function printUninstallPlan(result, verb) {
  console.log(`\n  ${verb} remove:`);
  for (const line of summarizePaths(result.removed)) console.log(`    ${line}`);
  if (result.edited.length > 0) {
    console.log(`\n  ${verb} edit (bluetemberg-owned keys, blocks or lines only):`);
    for (const path of result.edited) console.log(`    ${path}`);
  }
}

program
  .command('uninstall')
  .description('Remove generated output, managed config and bluetemberg state; keep files you wrote')
  .argument('[directory]', 'Project root directory', '.')
  .option('--dry-run', 'Show what would be removed or edited, change nothing')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .option('--silent', 'Suppress output')
  .action(async (directory, options) => {
    const { uninstall } = await import('../dist/uninstall/index.js');
    const root = resolve(directory);
    try {
      if (options.dryRun) {
        printUninstallPlan(await uninstall(root, { dryRun: true }), 'Would');
        return;
      }
      if (!options.yes) {
        if (!process.stdin.isTTY) {
          console.error('Error: uninstall deletes files. Pass --yes to confirm, or --dry-run to preview.');
          process.exit(1);
        }
        printUninstallPlan(await uninstall(root, { dryRun: true }), 'Will');
        const { confirm } = await import('@inquirer/prompts');
        if (!(await confirm({ message: 'Uninstall bluetemberg from this project?', default: false }))) {
          console.log('Nothing changed.');
          return;
        }
      }
      const result = await uninstall(root);
      if (!options.silent) {
        console.log(`\nRemoved ${result.removed.length} file(s), edited ${result.edited.length}.`);
        console.log(
          'Kept: AGENTS.md, CLAUDE.md, the GitHub files init scaffolded, and your own sources under llm/.',
        );
        console.log('Finish with: npm uninstall bluetemberg');
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

function printEjectPlan(result, verb) {
  console.log(`\n  ${verb} remove (bluetemberg config and state):`);
  for (const line of summarizePaths(result.removed)) console.log(`    ${line}`);
  if (result.edited.length > 0) {
    console.log(`\n  ${verb} edit (generated banners and managed-block markers only):`);
    for (const line of summarizePaths(result.edited)) console.log(`    ${line}`);
  }
}

program
  .command('eject')
  .description(
    'Keep the generated files as plain files you own; remove banners, config and bluetemberg state',
  )
  .argument('[directory]', 'Project root directory', '.')
  .option('--dry-run', 'Show what would be removed or edited, change nothing')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .option('--silent', 'Suppress output')
  .action(async (directory, options) => {
    const { eject } = await import('../dist/eject/index.js');
    const root = resolve(directory);
    try {
      if (options.dryRun) {
        printEjectPlan(await eject(root, { dryRun: true }), 'Would');
        return;
      }
      if (!options.yes) {
        if (!process.stdin.isTTY) {
          console.error('Error: eject deletes files. Pass --yes to confirm, or --dry-run to preview.');
          process.exit(1);
        }
        printEjectPlan(await eject(root, { dryRun: true }), 'Will');
        const { confirm } = await import('@inquirer/prompts');
        if (!(await confirm({ message: 'Eject bluetemberg from this project?', default: false }))) {
          console.log('Nothing changed.');
          return;
        }
      }
      const result = await eject(root);
      if (!options.silent) {
        console.log(`\nRemoved ${result.removed.length} file(s), edited ${result.edited.length}.`);
        console.log(
          'Kept as plain files you own: every generated file, AGENTS.md, MCP servers, hooks and guardrails, and your sources under llm/ (nothing syncs them now).',
        );
        console.log(
          'Finish with: npm uninstall bluetemberg, and drop any package.json scripts that call it.',
        );
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('preview')
  .description(
    'Preview the packs a profile preselects (writes nothing but the catalog cache under .bluetemberg/)',
  )
  .argument('[profile]', `Profile to preview (one of: ${[...TEAM_PROFILES].join(', ')})`)
  .option('--list', 'List all available profiles')
  .option('--force', 'Force re-fetch of the pack catalog')
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (profile, options) => {
    const { preview, previewList } = await import('../dist/preview/index.js');

    if (options.list || !profile) {
      await previewList({ silent: options.silent });
      return;
    }

    if (!TEAM_PROFILES.has(profile)) {
      console.error(`Unknown profile "${profile}". Expected one of: ${[...TEAM_PROFILES].join(', ')}`);
      process.exit(1);
    }

    try {
      await preview(process.cwd(), profile, {
        silent: options.silent,
        force: options.force,
      });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('detect')
  .description('Detect technology stacks + versions in the project and report coverage/gaps')
  .argument('[directory]', 'Project root directory', '.')
  .option('--json', 'Emit machine-readable JSON (detected, gaps, warnings)')
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (directory, options) => {
    const { runDetect } = await import('../dist/stacks/report.js');
    try {
      runDetect(resolve(directory), { json: options.json, silent: options.silent, log: console.log });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('coverage')
  .description('Query whether version-correct guidance exists for a stack (e.g. "payload@3.4.0")')
  .argument('<stack>', 'Stack name with optional @version (e.g. payload@3 or nextjs)')
  .argument('[directory]', 'Project root directory', '.')
  .option('--json', 'Emit machine-readable JSON')
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (stackSpec, directory, options) => {
    const { runCoverage } = await import('../dist/stacks/report.js');
    const atIdx = String(stackSpec).indexOf('@');
    const stack = atIdx === -1 ? stackSpec : stackSpec.slice(0, atIdx);
    const version = atIdx === -1 ? undefined : stackSpec.slice(atIdx + 1) || undefined;
    try {
      runCoverage(resolve(directory), stack, version, {
        json: options.json,
        silent: options.silent,
        log: console.log,
      });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

const stacksCmd = program
  .command('stacks')
  .description('[maintainer] Inspect the stacks: ranges declared by guidance (lint, list)');

stacksCmd
  .command('lint')
  .description('Flag open-ended stacks: ranges and ranges past the latest released major')
  .argument('[directory]', 'Project root, or a packs repo (packages/<pack>/llm)', '.')
  .option('--offline', 'Do not query the npm registry; use cached latest versions only')
  .option('--json', 'Emit machine-readable JSON (findings, latest, unchecked, warnings)')
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (directory, options) => {
    const { buildRangeLintReport, formatRangeLint } = await import('../dist/stacks/ranges.js');
    try {
      const report = await buildRangeLintReport(resolve(directory), { offline: options.offline });
      if (!options.silent) {
        console.log(options.json ? JSON.stringify(report, null, 2) : formatRangeLint(report).join('\n'));
      }
      if (report.findings.length > 0) process.exitCode = 1;
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

stacksCmd
  .command('list')
  .description('List guidance declaring a range for a stack (e.g. "payload@3" or "payload@>=3 <4")')
  .argument('<stack>', 'Stack name with an optional @version or @range')
  .argument('[directory]', 'Project root, or a packs repo (packages/<pack>/llm)', '.')
  .option('--json', 'Emit machine-readable JSON (query, matches, nameLevel, warnings)')
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (stackSpec, directory, options) => {
    const { buildRangeListReport, formatRangeList } = await import('../dist/stacks/ranges.js');
    const atIdx = String(stackSpec).indexOf('@');
    const stack = atIdx === -1 ? stackSpec : stackSpec.slice(0, atIdx);
    const version = atIdx === -1 ? undefined : stackSpec.slice(atIdx + 1) || undefined;
    try {
      const report = buildRangeListReport(resolve(directory), stack, version);
      if (!options.silent) {
        console.log(options.json ? JSON.stringify(report, null, 2) : formatRangeList(report).join('\n'));
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('why')
  .description(
    'Explain why a rule, agent, skill or guardrail is included or excluded, or diff the set under a stack upgrade (--diff)',
  )
  .argument('[file]', 'Source path (llm/rules/x.md), generated path (.claude/rules/x.md), or id (x)')
  .argument('[directory]', 'Project root directory', '.')
  .option(
    '--diff <stack@version>',
    'List what would be added/removed if the stack were at this version (repeatable; writes nothing)',
    (spec, specs) => [...specs, spec],
    [],
  )
  .option('--json', 'Emit machine-readable JSON')
  .action(async (file, directory, options) => {
    const { buildWhyReport, buildWhyDiff, formatWhyReport, formatWhyDiff, parseStackOverride } =
      await import('../dist/stacks/why.js');
    const print = (data, lines) =>
      console.log(options.json ? JSON.stringify(data, null, 2) : lines.join('\n'));
    try {
      if (options.diff.length > 0) {
        // With --diff there is no <file>: a single positional is the project directory.
        const root = resolve(file ?? directory);
        if (
          (file !== undefined && directory !== '.') ||
          !statSync(root, { throwIfNoEntry: false })?.isDirectory()
        ) {
          throw new Error('--diff takes no <file>; pass only the project directory');
        }
        const report = buildWhyDiff(root, options.diff.map(parseStackOverride));
        print(report, formatWhyDiff(report));
        return;
      }
      if (file === undefined) throw new Error('pass a <file> to explain, or --diff <stack@version>');
      const report = buildWhyReport(resolve(directory), file, { cwd: process.cwd() });
      print(report, formatWhyReport(report));
      if (report.matchedAs === null) process.exitCode = 1;
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('scan-org')
  .description('[maintainer] Histogram stack+version usage across N repos vs catalog coverage (read-only)')
  .argument('[paths...]', 'Local repo root directories to scan (e.g. ../app-a ../app-b)')
  .option('--org <name>', '[remote] Scan every non-fork, non-archived repo in this GitHub org')
  .option('--repos <list>', '[remote] Comma-separated owner/repo to scan (e.g. acme/app,acme/web)')
  .option('--since <days>', '[remote --org] Only scan repos pushed to within the last N days', (v) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n <= 0)
      throw new InvalidArgumentError(`Expected a positive integer, got: ${JSON.stringify(v)}`);
    return n;
  })
  .option('--json', 'Emit machine-readable JSON (roots, histogram, gaps, skipped)')
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (paths, options) => {
    const { runScanOrg } = await import('../dist/stacks/scan.js');
    const { resolveGithubToken } = await import('../dist/stacks/github.js');
    const roots = [...new Set((paths ?? []).map((p) => resolve(p)))];
    const repos = options.repos ? csvList(options.repos) : [];
    const wantsRemote = Boolean(options.org) || repos.length > 0;

    if (roots.length === 0 && !wantsRemote) {
      if (!options.silent) {
        console.error('Error: provide local paths, or --org / --repos for a remote scan.');
      }
      process.exit(1);
    }

    const token = wantsRemote ? resolveGithubToken() : undefined;
    if (wantsRemote && !token) {
      if (!options.silent) {
        console.error('Error: No GitHub token found. Set GITHUB_TOKEN or GH_TOKEN in your environment.');
      }
      process.exit(1);
    }

    try {
      await runScanOrg(roots, {
        json: options.json,
        silent: options.silent,
        log: console.log,
        progress: console.error, // stderr — never corrupts --json on stdout
        catalogRoot: resolve('.'),
        org: options.org,
        repos,
        token,
        since: options.since,
      });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('add')
  .description('Add one or more packs (rules, agents, skills, guardrails) from the npm registry')
  .argument('<packages...>', 'Package name(s) with optional @version (e.g. my-rules@^1.0.0)')
  .option(
    '--skip-signature-verification',
    'Allow unsigned packs from a non-default registry (ignored for npmjs.org)',
  )
  .option(
    '--allow-external-tarball-host',
    'Allow tarballs served from a host other than the configured registry (no credentials are sent there)',
  )
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (packages, options) => {
    const { add } = await import('../dist/registry/index.js');
    const uniquePackages = [...new Set(packages)];
    const failed = [];

    for (const packageSpec of uniquePackages) {
      try {
        await add(process.cwd(), packageSpec, {
          silent: options.silent,
          skipSignatureVerification: options.skipSignatureVerification,
          allowExternalTarballHost: options.allowExternalTarballHost,
        });
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        failed.push(packageSpec);
      }
    }

    if (failed.length < uniquePackages.length) {
      const { refreshCatalogCache } = await import('../dist/catalog/index.js');
      const refreshed = await refreshCatalogCache(process.cwd());
      if (!refreshed && !options.silent) {
        console.error(
          'Warning: failed to refresh .bluetemberg/catalog.json; later catalog-based commands may use stale pack metadata.',
        );
      }
    }

    if (failed.length > 0) {
      if (!options.silent && uniquePackages.length > 1) {
        console.error(
          `Failed to add ${failed.length} of ${uniquePackages.length} pack(s): ${failed.join(', ')}`,
        );
      }
      process.exit(1);
    }
  });

program
  .command('remove')
  .description('Remove a pack from the project')
  .argument('<package>', 'Package name to remove')
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (packageName, options) => {
    const { remove } = await import('../dist/registry/index.js');
    try {
      await remove(process.cwd(), packageName, { silent: options.silent });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List installed packs')
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (options) => {
    const { list } = await import('../dist/registry/index.js');
    try {
      list(process.cwd(), { silent: options.silent });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('install')
  .description('Install all packs from llm/packages.json (like npm ci)')
  .option('--force', 'Force re-download even if cached')
  .option('--dry-run', 'Resolve packs and print install plan without writing files')
  .option(
    '--skip-signature-verification',
    'Allow unsigned packs from a non-default registry (ignored for npmjs.org)',
  )
  .option(
    '--allow-external-tarball-host',
    'Allow tarballs served from a host other than the configured registry (no credentials are sent there)',
  )
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (options) => {
    const { install } = await import('../dist/registry/index.js');
    try {
      await install(process.cwd(), {
        force: options.force,
        silent: options.silent,
        dryRun: options.dryRun,
        skipSignatureVerification: options.skipSignatureVerification,
        allowExternalTarballHost: options.allowExternalTarballHost,
      });
      if (!options.dryRun) {
        const { refreshCatalogCache } = await import('../dist/catalog/index.js');
        const refreshed = await refreshCatalogCache(process.cwd());
        if (!refreshed && !options.silent) {
          console.error(
            'Warning: failed to refresh .bluetemberg/catalog.json; later catalog-based commands may use stale pack metadata.',
          );
        }
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('update')
  .description('Update packs to the latest version satisfying their manifest range')
  .argument('[package]', 'Package name to update (updates all when omitted)')
  .option('--latest', 'Widen ranges to "latest" in manifest, not just re-resolve current range')
  .option(
    '--skip-signature-verification',
    'Allow unsigned packs from a non-default registry (ignored for npmjs.org)',
  )
  .option(
    '--allow-external-tarball-host',
    'Allow tarballs served from a host other than the configured registry (no credentials are sent there)',
  )
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (packageName, options) => {
    const { update } = await import('../dist/registry/index.js');
    try {
      await update(process.cwd(), packageName, {
        latest: options.latest,
        silent: options.silent,
        skipSignatureVerification: options.skipSignatureVerification,
        allowExternalTarballHost: options.allowExternalTarballHost,
      });
      const { refreshCatalogCache } = await import('../dist/catalog/index.js');
      const refreshed = await refreshCatalogCache(process.cwd());
      if (!refreshed && !options.silent) {
        console.error(
          'Warning: failed to refresh .bluetemberg/catalog.json; later catalog-based commands may use stale pack metadata.',
        );
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search the npm registry for bluetemberg packs')
  .argument('<query>', 'Search query')
  .option('--limit <n>', 'Max results (default: 20)', (s) => parseInt(s, 10))
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (query, options) => {
    const { search } = await import('../dist/registry/index.js');
    try {
      await search(query, {
        limit: options.limit,
        silent: options.silent,
      });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('verify')
  .description('Verify integrity and registry signatures of all installed packs')
  .argument('[directory]', 'Project root directory', '.')
  .option(
    '--skip-signature-verification',
    'Skip ECDSA signature check (for self-hosted registries without signing)',
  )
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (directory, options) => {
    const { verify } = await import('../dist/registry/index.js');
    try {
      const results = await verify(resolve(directory), {
        silent: options.silent,
        skipSignatureVerification: options.skipSignatureVerification,
      });
      const hasFailures = results.some((r) => r.status !== 'ok');
      if (hasFailures) process.exit(1);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

const mcpCmd = program.command('mcp').description('Run Bluetemberg itself as an MCP server for agents');

mcpCmd
  .command('serve')
  .description('Serve stack detection + coverage as MCP tools over stdio (read-only)')
  .argument('[directory]', 'Project root directory', '.')
  .action(async (directory) => {
    const { serveStdio } = await import('../dist/mcp/server.js');
    // stdout is the MCP protocol channel — never write to it here. Status goes to stderr.
    try {
      await serveStdio(resolve(directory), pkg.version);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
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
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (spec, options) => {
    const { addSource } = await import('../dist/sources/registry.js');
    try {
      await addSource(process.cwd(), spec, { silent: options.silent });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

sourceCmd
  .command('remove')
  .description('Remove an external source by key')
  .argument('<key>', 'Source key (as shown by "bluetemberg source list")')
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (key, options) => {
    const { removeSource } = await import('../dist/sources/registry.js');
    try {
      removeSource(process.cwd(), key, { silent: options.silent });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

sourceCmd
  .command('list')
  .description('List configured external sources')
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (options) => {
    const { listSources } = await import('../dist/sources/registry.js');
    try {
      listSources(process.cwd(), { silent: options.silent });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

sourceCmd
  .command('install')
  .description('Install all external sources from the manifest (like npm ci)')
  .option('--force', 'Force re-download even if cached')
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (options) => {
    const { installSources } = await import('../dist/sources/registry.js');
    try {
      await installSources(process.cwd(), { force: options.force, silent: options.silent });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

sourceCmd
  .command('update')
  .description('Re-resolve external sources to the newest ref/version satisfying their spec')
  .argument('[key]', 'Source key to update (updates all when omitted)')
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (key, options) => {
    const { updateSources } = await import('../dist/sources/registry.js');
    try {
      await updateSources(process.cwd(), key, { silent: options.silent });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

sourceCmd
  .command('search')
  .description('Search external sources that support discovery (PRPM, cursor.directory)')
  .argument('<query>', 'Search query')
  .option('--type <type>', 'Restrict to one backend: prpm | cursor-directory')
  .option('--limit <n>', 'Max results (default: 20)', (s) => parseInt(s, 10))
  .option('--silent', 'Suppress progress output (errors still go to stderr)')
  .action(async (query, options) => {
    const { searchSources } = await import('../dist/sources/registry.js');
    try {
      await searchSources(query, { type: options.type, limit: options.limit, silent: options.silent });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

const { findReservedFlagCollisions, formatReservedFlagCollisions } = await import('../dist/cli-guards.js');
const flagCollisions = findReservedFlagCollisions(program);
if (flagCollisions.length > 0) {
  console.error(formatReservedFlagCollisions(flagCollisions));
  process.exit(1);
}

program.parse();
