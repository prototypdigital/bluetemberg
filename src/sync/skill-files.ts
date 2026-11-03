import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkFiles } from '../utils/fs.js';
import { hasGeneratedBanner } from './banner.js';
import { commitPlannedCopy, type SyncSink } from './pipeline.js';

/**
 * A skill is a directory, not a file. Next to `SKILL.md` the Agent Skills layout allows `scripts/`,
 * `references/` and `assets/` (any supporting file, really), and a skill that says "run
 * `scripts/check.sh`" is broken when only `SKILL.md` arrives. Everything but `SKILL.md` itself.
 */
export function listSkillSupportingFiles(skillDir: string): string[] {
  return walkFiles(skillDir).filter((rel) => rel !== 'SKILL.md');
}

/** Copies a skill's supporting files under `outDir`, byte for byte and with their modes kept. */
export function copySkillSupportingFiles(sink: SyncSink, skillDir: string, outDir: string): void {
  for (const rel of listSkillSupportingFiles(skillDir)) {
    commitPlannedCopy(sink, join(skillDir, rel), join(outDir, rel));
  }
}

/**
 * True when an output skill dir holds something sync did not write: a `SKILL.md` without the banner,
 * or files with no `SKILL.md` at all. Writing a bannered `SKILL.md` there would make `--prune` treat
 * every file in the dir as generated and delete it, so the dir is left alone. A `SKILL.md` identical
 * to `sourceContent` is a copy sync made before it added banners, and still counts as sync's.
 */
export function isHandWrittenSkillDir(skillDir: string, sourceContent?: string): boolean {
  const skillMd = join(skillDir, 'SKILL.md');
  if (existsSync(skillMd)) {
    const content = readFileSync(skillMd, 'utf8');
    if (hasGeneratedBanner(content)) return false;
    return (
      sourceContent === undefined || content.replace(/\r\n/g, '\n') !== sourceContent.replace(/\r\n/g, '\n')
    );
  }
  return existsSync(skillDir) && readdirSync(skillDir).length > 0;
}
