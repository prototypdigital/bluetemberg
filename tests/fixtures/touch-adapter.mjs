import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function run(ctx) {
  writeFileSync(join(ctx.root, 'adapter-touched'), 'ok\n', 'utf8');
}
