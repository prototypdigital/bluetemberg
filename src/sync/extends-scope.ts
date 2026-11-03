import type { BlueprintConfig, Platform } from '../types.js';
import { AGENTS_MD_RULE_PLATFORMS } from './codex.js';
import type { SourceView } from './sources.js';
import { dirKey, resolveAgentTargets, resolveRuleTargets, resolveSkillTargets } from './targets.js';

/**
 * Some outputs are written for more than one platform: Codex, Devin and Antigravity all load
 * `.agents/skills/`, Codex and Gemini read the rules block in `AGENTS.md`, and a custom `targets`
 * entry can point two platforms at one dir. Such an output can hold only one set of content, so the
 * platforms that share it must read the same sources. When scoped `extends` entries put them in
 * different source views, sync would write the output once per view and the last view would win
 * (and `--check` would never settle), so it is an error instead.
 */

/** The outputs `platform` writes content into: target dirs (`dir/`) and shared files. */
function contentOutputs(config: BlueprintConfig, platform: Platform): string[] {
  const dirs = [
    ...resolveRuleTargets(config, [platform]),
    ...resolveAgentTargets(config, [platform]),
    ...resolveSkillTargets(config, [platform]),
  ].map(([, target]) => `${dirKey(target.dir)}/`);
  if (AGENTS_MD_RULE_PLATFORMS.includes(platform)) dirs.push('AGENTS.md');
  return [...new Set(dirs)];
}

/**
 * One message per output shared by platforms in different source views (none when there is a
 * single view). Each names the output and the platforms, so the fix — scope their entries alike —
 * is obvious.
 */
export function findSplitSharedOutputs(config: BlueprintConfig, views: readonly SourceView[]): string[] {
  if (views.length < 2) return [];

  const writers = new Map<string, { platform: Platform; view: number }[]>();
  views.forEach((view, viewIndex) => {
    for (const platform of view.platforms) {
      for (const output of contentOutputs(config, platform)) {
        writers.set(output, [...(writers.get(output) ?? []), { platform, view: viewIndex }]);
      }
    }
  });

  const messages: string[] = [];
  for (const [output, list] of writers) {
    if (new Set(list.map((w) => w.view)).size < 2) continue;
    const names = list.map((w) => w.platform).join(', ');
    messages.push(
      `scoped "extends" entries give ${names} different sources, but they all write ${output} — scope those entries to all of ${names} or none of them`,
    );
  }
  return messages;
}
