import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import matter from 'gray-matter';
import type { BlueprintConfig, Platform } from '../types.js';
import { listFiles } from '../utils/fs.js';
import { hasGeneratedBanner, withGeneratedBanner, withGeneratedBannerToml } from './banner.js';
import { mergeSourceDirs } from './extends-loader.js';
import { commitPlannedWrite, type SyncSink } from './pipeline.js';
import { dirKey, normalizePlatforms, resolveSkillTargets } from './targets.js';

/**
 * Commands (`llm/commands/`) and prompt files (`llm/prompts/`) predate skills. Every host has
 * since folded them into skills: Claude Code merged custom commands into skills, VS Code ships a
 * "migrate prompt files to skills" action, Devin dropped workflows for skills. So each one is also
 * emitted as a generated skill to every skills target, and the old `.claude/commands/` and
 * `.github/prompts/` outputs are kept for a transition period only.
 */

export type LegacySkillKind = 'command' | 'prompt';

export interface LegacySkillSource {
  kind: LegacySkillKind;
  /** The file name without `.md` (and without `.prompt` for prompt files). */
  name: string;
  /** Source id relative to the source dir, e.g. `commands/ship.md`. */
  sourceId: string;
  path: string;
}

export interface LegacySkillsSyncContext extends SyncSink {
  sourceBase: string;
  sourceDirs: readonly string[];
  config: BlueprintConfig;
  platforms: readonly Platform[];
}

/** The release that stops writing `.claude/commands/` and `.github/prompts/`. */
export const LEGACY_OUTPUTS_REMOVAL_VERSION = '0.18.0';

/** Agent Skills `name`: lowercase letters, digits and single hyphens, at most 64 characters. */
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKILL_NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;

const LEGACY_DIRS: { kind: LegacySkillKind; subdir: string }[] = [
  { kind: 'command', subdir: 'commands' },
  { kind: 'prompt', subdir: 'prompts' },
];

function toSkillName(file: string): string {
  return basename(file, '.md').replace(/\.prompt$/, '');
}

/** Commands and prompts in the project's own `llm/`, commands first, as the legacy stages read them. */
export function listLegacySkillSources(sourceBase: string): LegacySkillSource[] {
  return LEGACY_DIRS.flatMap(({ kind, subdir }) => {
    const dir = join(sourceBase, subdir);
    return listFiles(dir, (f) => f.endsWith('.md') && f !== 'README.md').map((file) => ({
      kind,
      name: toSkillName(file),
      sourceId: `${subdir}/${file}`,
      path: join(dir, file),
    }));
  });
}

export function isValidSkillName(name: string): boolean {
  return name.length <= SKILL_NAME_MAX && SKILL_NAME.test(name);
}

/**
 * A description is required by every host. Without one in the source, fall back to the first
 * heading or line of the body, then to the slash-command name itself.
 */
function deriveDescription(body: string, name: string): string {
  const firstLine = body
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => line.length > 0);
  return (firstLine ?? `/${name}`).slice(0, DESCRIPTION_MAX);
}

/**
 * Prompt-file fields a skill has no equivalent for. VS Code's own prompt-to-skill migration drops
 * the same three and lists them; `mode` is the older spelling of `agent`.
 */
const PROMPT_ONLY_FIELDS = ['agent', 'mode', 'model', 'tools'];

export interface LegacySkillTranslation {
  /** The skill's name, which is also its directory and its `/name`. */
  name: string;
  content: string;
  /** Source frontmatter fields left out of the skill. */
  dropped: string[];
}

/**
 * A command is invoked by its file name. A prompt file's `name` field, when set, replaces the file
 * name after `/` in VS Code, so the skill takes that name to keep the same invocation.
 */
function resolveSkillName(data: Record<string, unknown>, fileName: string, kind: LegacySkillKind): string {
  if (kind === 'prompt' && typeof data.name === 'string' && data.name.trim().length > 0)
    return data.name.trim();
  return fileName;
}

/**
 * Translates a command or prompt file into `SKILL.md` content. The body is kept verbatim; the
 * frontmatter gains the required `name` and `description`, and `disable-model-invocation: true`
 * so the skill stays what the command was: something the user runs as `/name`, never loaded on
 * the model's own initiative (the same choice VS Code's and Cursor's migrations make). A command's
 * other fields are Claude Code skill fields too and are kept; a prompt loses its prompt-only ones.
 */
export interface LegacySkillOptions {
  /**
   * Devin ignores `disable-model-invocation`; its own switch is `triggers: [user]`. Only set for a
   * skills dir Devin reads, so other hosts never see a field they do not know.
   */
  devinTriggers?: boolean;
}

export function toLegacySkillContent(
  source: string,
  fileName: string,
  kind: LegacySkillKind,
  options: LegacySkillOptions = {},
): LegacySkillTranslation {
  const parsed = matter(source);
  const rest: Record<string, unknown> = { ...parsed.data };
  const name = resolveSkillName(rest, fileName, kind);
  const description = rest.description;
  delete rest.name;
  delete rest.description;
  const dropped = kind === 'prompt' ? PROMPT_ONLY_FIELDS.filter((field) => field in rest) : [];
  for (const field of dropped) delete rest[field];

  const describedBy =
    typeof description === 'string' && description.trim().length > 0
      ? description.trim().slice(0, DESCRIPTION_MAX)
      : deriveDescription(parsed.content, name);
  const data: Record<string, unknown> = {
    name,
    description: describedBy,
    'disable-model-invocation': true,
    ...rest,
  };
  if (options.devinTriggers && data['disable-model-invocation'] === true && !('triggers' in data)) {
    data.triggers = ['user'];
  }
  return { name, content: matter.stringify(parsed.content, data), dropped };
}

interface PlannedLegacySkill {
  name: string;
  source: LegacySkillSource;
  text: string;
  /** Whether the skill is user-invoked only, which Codex and Devin need told their own way. */
  userOnly: boolean;
}

/**
 * The legacy stages copy a command or prompt without parsing it, so a frontmatter block that is not
 * valid YAML used to sync fine. That stays a warning here: an error would fail the whole sync and
 * block `--prune` for a file that still reaches `.claude/commands/` or `.github/prompts/`.
 */
function translate(
  source: LegacySkillSource,
  text: string,
  recordWarning: (message: string) => void,
): LegacySkillTranslation | null {
  try {
    return toLegacySkillContent(text, source.name, source.kind);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordWarning(
      `${source.sourceId}: frontmatter could not be parsed, so no skill is generated for it (${message}).`,
    );
    return null;
  }
}

function readSource(source: LegacySkillSource, recordError: (message: string) => void): string | null {
  try {
    return readFileSync(source.path, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError(`${source.sourceId} -> skill: ${message}`);
    return null;
  }
}

/** Why a translated source gets no skill, or `null` when it gets one. */
function skipReason(
  sourceId: string,
  name: string,
  realSkills: ReadonlyMap<string, string>,
  claimed: ReadonlyMap<string, string>,
): string | null {
  if (!isValidSkillName(name)) {
    return `${sourceId}: "${name}" is not a valid skill name (lowercase letters, digits and single hyphens, at most ${SKILL_NAME_MAX} characters), so no skill is generated for it. Rename it to migrate it.`;
  }
  if (realSkills.has(name)) {
    return `${sourceId}: skill "${name}" already exists in skills/, so no skill is generated for it. The skill wins; rename or remove one of them.`;
  }
  const owner = claimed.get(name);
  if (owner) return `${sourceId}: ${owner} already generates skill "${name}", so this file gets none.`;
  return null;
}

/** Translates every source, dropping those a real skill or an earlier source already claims. */
function planLegacySkills(
  ctx: LegacySkillsSyncContext,
  recordError: (message: string) => void,
  recordWarning: (message: string) => void,
): PlannedLegacySkill[] {
  const realSkills = mergeSourceDirs([...ctx.sourceDirs], 'skills', (dir) =>
    existsSync(join(dir, 'SKILL.md')),
  );
  const claimed = new Map<string, string>();
  const planned: PlannedLegacySkill[] = [];

  for (const source of listLegacySkillSources(ctx.sourceBase)) {
    const text = readSource(source, recordError);
    if (text === null) continue;
    const translation = translate(source, text, recordWarning);
    if (!translation) continue;
    const { name, content, dropped } = translation;

    const reason = skipReason(source.sourceId, name, realSkills, claimed);
    if (reason) {
      recordWarning(reason);
      continue;
    }
    if (dropped.length > 0) {
      recordWarning(
        `${source.sourceId}: skill "${name}" leaves out ${dropped.join(', ')}, which skills have no field for. The prompt file keeps them until ${LEGACY_OUTPUTS_REMOVAL_VERSION}; for a fixed agent, model or tool set, write a custom agent instead.`,
      );
    }
    claimed.set(name, source.sourceId);
    const userOnly = matter(content).data['disable-model-invocation'] === true;
    planned.push({ name, source, text, userOnly });
  }
  return planned;
}

/**
 * One warning per sync, and only while the project still has commands or prompts that produce the
 * deprecated outputs on an enabled platform.
 */
function warnLegacyOutputs(ctx: LegacySkillsSyncContext, recordWarning: (message: string) => void): void {
  const sources = listLegacySkillSources(ctx.sourceBase);
  const outputs: string[] = [];
  if (ctx.platforms.includes('claude') && sources.some((s) => s.kind === 'command')) {
    outputs.push('llm/commands/ -> .claude/commands/');
  }
  if (ctx.platforms.includes('copilot') && sources.some((s) => s.kind === 'prompt')) {
    outputs.push('llm/prompts/ -> .github/prompts/');
  }
  if (outputs.length === 0) return;

  recordWarning(
    `Deprecated: ${outputs.join(' and ')}. Commands and prompts are now also synced as skills; the old outputs stop being written in ${LEGACY_OUTPUTS_REMOVAL_VERSION}. Move the files to llm/skills/<name>/SKILL.md, then run \`bluetemberg sync --prune\`. See the wiki: Writing Skills, "Migrating commands and prompts".`,
  );
}

/** The skills dirs a platform reads, normalized, among the enabled platforms. */
function skillDirsOf(ctx: LegacySkillsSyncContext, platform: Platform): Set<string> {
  if (!normalizePlatforms(ctx.platforms).includes(platform)) return new Set();
  return new Set(resolveSkillTargets(ctx.config, [platform]).map(([, target]) => dirKey(target.dir)));
}

/**
 * Codex ignores `disable-model-invocation`; a skill opts out of implicit invocation in its own
 * `agents/openai.yaml`. YAML takes the same `#` banner as TOML, so prune recognizes the file.
 */
function codexPolicy(sourceId: string): string {
  return withGeneratedBannerToml('policy:\n  allow_implicit_invocation: false\n', sourceId);
}

/**
 * True when the output dir holds something sync did not write: a `SKILL.md` without the banner, or
 * files with no `SKILL.md` at all. Writing a bannered `SKILL.md` there would make `--prune` treat
 * every file in the dir as generated and delete it, so the dir is left alone.
 */
function isHandWritten(skillDir: string): boolean {
  const skillMd = join(skillDir, 'SKILL.md');
  if (existsSync(skillMd)) return !hasGeneratedBanner(readFileSync(skillMd, 'utf8'));
  return existsSync(skillDir) && readdirSync(skillDir).length > 0;
}

/** Writes each command and prompt as a generated skill to every skills target. */
export function syncLegacySkills(
  ctx: LegacySkillsSyncContext,
  recordError: (message: string) => void,
  recordWarning: (message: string) => void,
): void {
  warnLegacyOutputs(ctx, recordWarning);

  const targets = resolveSkillTargets(ctx.config, ctx.platforms);
  if (targets.length === 0) return;

  const planned = planLegacySkills(ctx, recordError, recordWarning);
  if (planned.length === 0) return;

  const devinDirs = skillDirsOf(ctx, 'devin');
  const codexDirs = skillDirsOf(ctx, 'codex');

  ctx.log(`Commands and prompts as skills: ${planned.length} source file(s)`);
  for (const [, target] of targets) {
    const dir = dirKey(target.dir);
    let written = 0;
    for (const skill of planned) {
      const skillDir = join(ctx.root, target.dir, skill.name);
      if (isHandWritten(skillDir)) {
        recordWarning(
          `${target.dir}/${skill.name}/ holds files bluetemberg did not write, so it is kept and no skill is generated there.`,
        );
        continue;
      }
      const { content } = toLegacySkillContent(skill.text, skill.source.name, skill.source.kind, {
        devinTriggers: devinDirs.has(dir),
      });
      commitPlannedWrite(
        ctx,
        join(skillDir, 'SKILL.md'),
        withGeneratedBanner(content, skill.source.sourceId),
      );
      if (skill.userOnly && codexDirs.has(dir)) {
        commitPlannedWrite(ctx, join(skillDir, 'agents', 'openai.yaml'), codexPolicy(skill.source.sourceId));
      }
      written++;
    }
    if (!ctx.checkMode) ctx.log(`  -> ${target.dir}/ (${written} skills)`);
  }
}
