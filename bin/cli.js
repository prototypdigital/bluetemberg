#!/usr/bin/env node

import { program } from 'commander';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

program
  .name('blueprint')
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
  .option('--check', 'Dry-run: exit 1 if files are out of sync')
  .action(async (directory, options) => {
    const { sync, loadConfig } = await import('../dist/sync/index.js');
    const root = resolve(directory);
    const config = loadConfig(root);
    const results = sync(root, { check: options.check, config });

    if (options.check && results.outOfSync > 0) {
      process.exit(1);
    }
  });

program.parse();
