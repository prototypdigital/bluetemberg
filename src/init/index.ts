import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { sync } from '../sync/index.js';
import type { InitAnswers, InitRunOptions } from '../types.js';
import { finalizeNonInteractiveAnswers } from './init-answers-from-profile.js';
import { readInitAnswersFromFile } from './parse-init-answers.js';
import { runPrompts } from './prompts.js';
import { scaffold } from './scaffold.js';
import { invalidStackVersions } from './stacks-csv.js';

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
  const silent = Boolean(run?.silent);
  assertMutuallyExclusiveInitOptions(run ?? {});

  const log = (...args: Parameters<typeof console.log>) => {
    if (!silent) console.log(...args);
  };

  log(`\n  Bluetemberg — AI tooling scaffolder\n`);
  log(`  Target: ${targetDir}\n`);

  const configExists = existsSync(resolve(targetDir, 'bluetemberg.config.json'));
  if (configExists) {
    log('  ⚠ bluetemberg.config.json already exists in this directory.');
    log('  Running init will overwrite existing config and llm/ files.\n');
  }

  const answers = await resolveInitAnswers(targetDir, run);

  const badStacks = invalidStackVersions(answers.stacks ?? {});
  if (badStacks.length > 0) {
    log(`\n  ⚠ Stack version(s) that aren't a semver range or "auto": ${badStacks.join(', ')}`);
    log("    Treated as a literal pin — they won't match any rule until corrected.\n");
  }

  log('\nScaffolding...\n');
  const created = scaffold(targetDir, answers);

  log(`Created ${created.length} files:\n`);
  for (const f of created) {
    log(`  ${relative(targetDir, f)}`);
  }

  log('\nRunning initial sync...\n');
  await sync(targetDir, { silent });

  log('\n  Done! Next steps:\n');
  if (answers.ruleSource === 'collections') {
    log('  1. Run `bluetemberg install` to download the selected packs');
    log('  2. Run `npx bluetemberg sync` to generate platform files');
    log('  3. Add project-specific rules in llm/rules/ to override pack content');
  } else if (answers.ruleSource === 'none') {
    log('  1. Add your own rules to llm/rules/ (or install a pack with `bluetemberg add`)');
    log('  2. Customize agents and skills for your project');
    log('  3. Run `npx bluetemberg sync` after any changes to llm/');
  } else {
    log('  1. Review the generated files in llm/');
    log('  2. Customize rules, agents, and skills for your project');
    log('  3. Run `npx bluetemberg sync` after any changes to llm/');
  }
  log('');
}
