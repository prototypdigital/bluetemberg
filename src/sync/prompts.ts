import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Platform } from '../types.js';
import { listFiles } from '../utils/fs.js';
import type { SyncSink } from './pipeline.js';
import { commitPlannedWrite } from './pipeline.js';

export interface PromptsSyncContext extends SyncSink {
  sourceBase: string;
  platforms: readonly Platform[];
}

function toPromptFileName(file: string): string | null {
  if (!file.endsWith('.md')) return null;
  const base = basename(file, '.md');
  if (base === 'README') return null;
  if (base.endsWith('.prompt')) {
    return `${base}.md`;
  }
  return `${base}.prompt.md`;
}

export function syncCopilotPrompts(ctx: PromptsSyncContext, recordError: (message: string) => void): void {
  if (!ctx.platforms.includes('copilot')) return;

  const sourceDir = join(ctx.sourceBase, 'prompts');
  const files = listFiles(sourceDir, (f) => f.endsWith('.md'));
  if (files.length === 0) return;

  const toSync = files
    .map((f) => ({ file: f, outName: toPromptFileName(f) }))
    .filter((x): x is { file: string; outName: string } => x.outName !== null);

  if (toSync.length === 0) return;

  ctx.log(`Prompts: ${toSync.length} source file(s) (Copilot)`);
  const outDir = join(ctx.root, '.github', 'prompts');

  for (const { file, outName } of toSync) {
    try {
      const content = readFileSync(join(sourceDir, file), 'utf8');
      const outPath = join(outDir, outName);
      commitPlannedWrite(ctx, outPath, content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordError(`prompts/${file}: ${message}`);
    }
  }

  if (!ctx.checkMode) {
    ctx.log(`  -> .github/prompts/ (${toSync.length} files)`);
  }
}
