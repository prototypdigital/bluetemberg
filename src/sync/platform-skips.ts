import type { BlueprintConfig, Platform } from '../types.js';
import { allowsAnyPlatform, allowsPlatform } from '../catalog/platforms.js';
import { AGENTS_MD_RULE_PLATFORMS } from './codex.js';
import type { ContentKind } from './sources.js';
import { normalizePlatforms, resolveSkillOutputs, skillDirsFor } from './targets.js';

/**
 * The platforms that compile guardrails into hooks: Claude Code (`guardrails.ts`), Cursor
 * (`hooks.ts`), Codex (`guardrails-codex.ts`), Copilot (`guardrails-copilot.ts`) and Devin
 * (`guardrails-devin.ts`). Gemini, Antigravity and the marketplace compile none.
 */
export const GUARDRAIL_PLATFORMS: readonly Platform[] = ['claude', 'cursor', 'codex', 'copilot', 'devin'];

/**
 * The configured platforms that get no output for an item limited to `list`. Sync's
 * `limited by platform` log and `why` both read it, so they name the same platforms.
 *
 * A platform outside `list` is not skipped when it reads an output that is written anyway because
 * another of its readers is allowed: a Devin-only skill lands in `.agents/skills/`, which Codex reads
 * too, and a Gemini-only rule lands in the `AGENTS.md` block Codex reads. For guardrails, a platform
 * that compiles no guardrails is always skipped.
 */
export function skippedPlatforms(
  config: BlueprintConfig,
  platforms: readonly Platform[],
  kind: ContentKind,
  list: readonly string[] | null,
): Platform[] {
  const configured = normalizePlatforms(platforms);
  if (kind === 'guardrails') {
    return configured.filter((p) => !GUARDRAIL_PLATFORMS.includes(p) || !allowsPlatform(list, p));
  }
  return configured.filter(
    (p) => !allowsPlatform(list, p) && !readsSharedOutput(config, configured, kind, list, p),
  );
}

function readsSharedOutput(
  config: BlueprintConfig,
  configured: readonly Platform[],
  kind: ContentKind,
  list: readonly string[] | null,
  platform: Platform,
): boolean {
  if (kind === 'rules') {
    const readers = AGENTS_MD_RULE_PLATFORMS.filter((p) => configured.includes(p));
    return readers.includes(platform) && allowsAnyPlatform(list, readers);
  }
  if (kind !== 'skills') return false;
  return skillDirsFor(resolveSkillOutputs(config, configured), list).some((output) =>
    output.platforms.includes(platform),
  );
}
