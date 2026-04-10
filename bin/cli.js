#!/usr/bin/env node

import { program } from 'commander';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

program
  .name('bluetemberg')
  .description('Scaffold and sync vendor-neutral AI tooling config')
  .version(pkg.version);

program
  .command('init')
  .description('Initialize AI tooling in a project')
  .argument('[directory]', 'Target directory', '.')
  .action(async (directory) => {
    const { init } = await import('../dist/init/index.js');
    await init(resolve(directory));
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
  .action((options) => {
    const importRegistry = import('../dist/registry/index.js');
    importRegistry.then(({ list }) => {
      try {
        list(process.cwd(), { silent: options.silent });
      } catch (err) {
        if (!options.silent) {
          console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exit(1);
      }
    });
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
  .command('search')
  .description('Search the npm registry for bluetemberg rule packs')
  .argument('<query>', 'Search query')
  .option('--limit <n>', 'Max results (default: 20)', parseInt)
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
