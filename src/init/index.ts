import { resolve, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { runPrompts } from './prompts.js';
import { scaffold } from './scaffold.js';
import { sync } from '../sync/index.js';

export async function init(targetPath?: string): Promise<void> {
  const targetDir = resolve(targetPath || '.');

  console.log(`\n  Bluetemberg — AI tooling scaffolder\n`);
  console.log(`  Target: ${targetDir}\n`);

  const configExists = existsSync(resolve(targetDir, 'bluetemberg.config.json'));
  if (configExists) {
    console.log('  ⚠ bluetemberg.config.json already exists in this directory.');
    console.log('  Running init will overwrite existing config and llm/ files.\n');
  }

  const answers = await runPrompts(targetDir);

  console.log('\nScaffolding...\n');
  const created = scaffold(targetDir, answers);

  console.log(`Created ${created.length} files:\n`);
  for (const f of created) {
    console.log(`  ${relative(targetDir, f)}`);
  }

  console.log('\nRunning initial sync...\n');
  sync(targetDir);

  const pm = answers.packageManager === 'npm' ? 'npm run' : answers.packageManager;
  console.log('\n  Done! Next steps:\n');
  console.log('  1. Review the generated files in llm/');
  console.log('  2. Customize rules, agents, and skills for your project');
  console.log(`  3. Run \`${pm} sync:llm-config\` after any changes to llm/`);
  console.log('');
}
