import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform } from '../types.js';
import { listFiles } from '../utils/fs.js';
import type { SyncSink } from './pipeline.js';
import { commitPlannedWrite, ensurePlannedDir } from './pipeline.js';

export interface CommandsSyncContext extends SyncSink {
  sourceBase: string;
  platforms: readonly Platform[];
}

export function syncCommands(ctx: CommandsSyncContext, recordError: (message: string) => void): void {
  if (!ctx.platforms.includes('claude')) return;

  const sourceDir = join(ctx.sourceBase, 'commands');
  const files = listFiles(sourceDir, (f) => f.endsWith('.md') && f !== 'README.md');
  if (files.length === 0) return;

  ctx.log(`Commands: ${files.length} source file(s)`);
  const outDir = join(ctx.root, '.claude', 'commands');
  ensurePlannedDir(ctx, outDir);

  for (const file of files) {
    try {
      const content = readFileSync(join(sourceDir, file), 'utf8');
      const outPath = join(outDir, file);
      commitPlannedWrite(ctx, outPath, content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordError(`commands/${file}: ${message}`);
    }
  }

  if (!ctx.checkMode) {
    ctx.log(`  -> .claude/commands/ (${files.length} files)`);
  }
}
