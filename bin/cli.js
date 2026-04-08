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
  .action(async (directory, options) => {
    const { sync, loadConfig } = await import('../dist/sync/index.js');
    const root = resolve(directory);
    const config = loadConfig(root);
    const check = options.check || options.dryRun || false;
    const results = sync(root, { check, config, silent: options.silent });

    if (check && results.outOfSync > 0) {
      process.exit(1);
    }
  });

program.parse();
