import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform } from '../types.js';
import { listFiles } from '../utils/fs.js';
import type { SyncSink } from './pipeline.js';
import { commitPlannedWrite } from './pipeline.js';

export interface WindsurfWorkflowsSyncContext extends SyncSink {
  sourceBase: string;
  platforms: readonly Platform[];
}

export function syncWindsurfWorkflows(
  ctx: WindsurfWorkflowsSyncContext,
  recordError: (message: string) => void,
): void {
  if (!ctx.platforms.includes('windsurf')) return;

  const sourceDir = join(ctx.sourceBase, 'commands');
  const files = listFiles(sourceDir, (f) => f.endsWith('.md') && f !== 'README.md');
  if (files.length === 0) return;

  ctx.log(`Windsurf workflows: ${files.length} source file(s)`);
  const outDir = join(ctx.root, '.windsurf', 'workflows');

  for (const file of files) {
    try {
      const content = readFileSync(join(sourceDir, file), 'utf8');
      const outPath = join(outDir, file);
      commitPlannedWrite(ctx, outPath, content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordError(`commands/${file} -> windsurf workflows: ${message}`);
    }
  }

  if (!ctx.checkMode) {
    ctx.log(`  -> .windsurf/workflows/ (${files.length} files)`);
  }
}
