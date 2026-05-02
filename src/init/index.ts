import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { sync } from '../sync/index.js';
import type { InitAnswers, InitRunOptions } from '../types.js';
import { finalizeNonInteractiveAnswers } from './init-answers-from-profile.js';
import { readInitAnswersFromFile } from './parse-init-answers.js';
import { runPrompts } from './prompts.js';
import { scaffold } from './scaffold.js';

function assertMutuallyExclusiveInitOptions(run: InitRunOptions): void {
  if (run.answers) {
    if (run.configPath) {
      throw new Error('Init: use either answers or configPath, not both.');
    }
    if (run.nonInteractive || run.nonInteractiveOverrides) {
      throw new Error('Init: intrinsic answers conflict with non-interactive options.');
    }
  }

  if (run.configPath && run.nonInteractive) {
    throw new Error('Init: use either configPath or nonInteractive, not both.');
  }

  if (run.configPath && run.nonInteractiveOverrides !== undefined) {
    const entries = Object.keys(run.nonInteractiveOverrides);
    if (entries.length > 0) {
      throw new Error('Init: cannot merge nonInteractiveOverrides when using configPath.');
    }
  }
}

async function resolveInitAnswers(targetDir: string, run?: InitRunOptions): Promise<InitAnswers> {
  const opts = run ?? {};

  if (opts.answers) return opts.answers;

  if (opts.configPath) {
    return readInitAnswersFromFile(resolve(opts.configPath));
  }

  if (opts.nonInteractive) {
    const profile = opts.profile ?? 'fullstack';
    return finalizeNonInteractiveAnswers(profile, targetDir, opts.nonInteractiveOverrides ?? {});
  }

  return runPrompts(targetDir);
}

export async function init(targetPath?: string, run?: InitRunOptions): Promise<void> {
  const targetDir = resolve(targetPath || '.');
  assertMutuallyExclusiveInitOptions(run ?? {});

  console.log(`\n  Bluetemberg — AI tooling scaffolder\n`);
  console.log(`  Target: ${targetDir}\n`);

  const configExists = existsSync(resolve(targetDir, 'bluetemberg.config.json'));
  if (configExists) {
    console.log('  ⚠ bluetemberg.config.json already exists in this directory.');
    console.log('  Running init will overwrite existing config and llm/ files.\n');
  }

  const answers = await resolveInitAnswers(targetDir, run);

  console.log('\nScaffolding...\n');
  const created = scaffold(targetDir, answers);

  console.log(`Created ${created.length} files:\n`);
  for (const f of created) {
    console.log(`  ${relative(targetDir, f)}`);
  }

  console.log('\nRunning initial sync...\n');
  await sync(targetDir);

  const pm = answers.packageManager === 'npm' ? 'npm run' : answers.packageManager;
  console.log('\n  Done! Next steps:\n');
  if (answers.ruleSource === 'collections') {
    console.log('  1. Run `bluetemberg install` to download rule collections');
    console.log(`  2. Run \`${pm} sync:llm-config\` to generate platform files`);
    console.log('  3. Add project-specific rules in llm/rules/ to override collection rules');
  } else {
    console.log('  1. Review the generated files in llm/');
    console.log('  2. Customize rules, agents, and skills for your project');
    console.log(`  3. Run \`${pm} sync:llm-config\` after any changes to llm/`);
  }
  console.log('');
}
