import { PLUGIN_BUNDLE_PLATFORMS } from '../types.js';
import type { BlueprintConfig, Platform } from '../types.js';
import { AGENTS_MD_RULE_PLATFORMS } from './codex.js';
import type { ContentKind, SourceView } from './sources.js';
import { dirKey, resolveAgentTargets, resolveRuleTargets, resolveSkillOutputs } from './targets.js';

/**
 * Some outputs are written for more than one platform: Codex, Devin and Antigravity all load
 * `.agents/skills/`, Codex and Gemini read the rules block in `AGENTS.md`, and a custom `targets`
 * entry can point two platforms at one dir. Such an output can hold only one set of content, so the
 * platforms that share it must get the same content of the kind it holds. When scoped `extends`
 * entries give them different content, sync would write the output once per group and the last
 * would win (and `--check` would never settle), so it is an error instead.
 */

/** Content kinds a plugin bundle holds (guardrails are compiled into hooks, never bundled). */
const BUNDLE_KINDS: readonly ContentKind[] = ['rules', 'skills', 'agents'];

/** The outputs `platform` writes content into, with the content kind each holds. */
function contentOutputs(config: BlueprintConfig, platform: Platform): Array<[string, ContentKind]> {
  const dirsOf = (
    targets: Array<[Platform, { dir: string }]>,
    kind: ContentKind,
  ): Array<[string, ContentKind]> => targets.map(([, target]) => [`${dirKey(target.dir)}/`, kind]);
  // Skills are not per platform: which dir a platform writes depends on its group (Cursor is left to
  // Claude's dir when they share one), so `skillWriters` places them.
  const outputs = [
    ...dirsOf(resolveRuleTargets(config, [platform]), 'rules'),
    ...dirsOf(resolveAgentTargets(config, [platform]), 'agents'),
  ];
  if (AGENTS_MD_RULE_PLATFORMS.includes(platform)) outputs.push(['AGENTS.md', 'rules']);
  return outputs;
}

/**
 * One message per output whose platforms fall in different groups for the kind it holds (see
 * `groupViewsByKind`): their sources would give it different content. Platforms whose scopes differ
 * only in other kinds share the group, so a rules-only entry scoped to Codex does not split
 * `.agents/skills/`. Each message names the output and the platforms, so the fix is obvious.
 */
export function findSplitSharedOutputs(
  config: BlueprintConfig,
  groups: ReadonlyMap<ContentKind, readonly SourceView[]>,
): string[] {
  const writers = new Map<string, { platform: Platform; group: number }[]>();
  const add = (output: string, platform: Platform, group: number): void => {
    writers.set(output, [...(writers.get(output) ?? []), { platform, group }]);
  };
  for (const [kind, kindGroups] of groups) {
    kindGroups.forEach((group, groupIndex) => {
      // `claude-marketplace` and `agent-plugins` write rules, skills and agents into the same
      // `plugins/<name>/` bundles, so they must read the same sources for each of those kinds.
      if (BUNDLE_KINDS.includes(kind)) {
        for (const platform of group.platforms) {
          // Keyed per kind: group numbers are only comparable within one kind.
          if (PLUGIN_BUNDLE_PLATFORMS.includes(platform)) add(`plugins/ (${kind})`, platform, groupIndex);
        }
      }
      if (kind === 'skills') {
        // A covered reader (Cursor, left to Claude's dir) writes nothing of its own.
        for (const output of resolveSkillOutputs(config, group.platforms)) {
          for (const platform of output.platforms) {
            if (!output.covered.includes(platform))
              add(`${dirKey(output.target.dir)}/`, platform, groupIndex);
          }
        }
        return;
      }
      for (const platform of group.platforms) {
        for (const [output, outputKind] of contentOutputs(config, platform)) {
          if (outputKind !== kind) continue;
          add(output, platform, groupIndex);
        }
      }
    });
  }

  const messages: string[] = [];
  for (const [output, list] of writers) {
    if (new Set(list.map((w) => w.group)).size < 2) continue;
    const names = list.map((w) => w.platform).join(', ');
    messages.push(
      `scoped "extends" entries give ${names} different content for ${output}, which they all write — scope those entries to all of ${names} or none of them`,
    );
  }
  return messages;
}
