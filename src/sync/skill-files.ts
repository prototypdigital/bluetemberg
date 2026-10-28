import { join } from 'node:path';
import { walkFiles } from '../utils/fs.js';
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
