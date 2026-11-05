/**
 * Frontmatter parsing accepts only YAML fences. Pack, `extends` and external-source content is
 * untrusted, so a fence naming any other engine must be refused before it reaches gray-matter.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  frontmatterFenceLanguage,
  parseFrontmatter,
  readFrontmatter,
  stringifyFrontmatter,
  UnsupportedFrontmatterError,
} from '../src/utils/frontmatter.js';
import { parseDoc, stringifyDoc } from '../src/sources/translate/frontmatter.js';
import { toLegacySkillContent } from '../src/sync/legacy-skills.js';
import { agentSkillIssue } from '../src/sync/agent-plugins.js';
import { stampSkillMetadata } from '../src/sync/skill-metadata.js';
import { buildWhyReport } from '../src/stacks/why.js';
import { sync } from '../src/sync/index.js';

const MARKER = '__btFrontmatterMarker';
const markers = globalThis as Record<string, unknown>;

/** A fenced block that, if evaluated as code, would set the marker. */
function codeFenced(fence: string, body = '# body\n'): string {
  return `---${fence}\n({ name: 'x', description: (globalThis.${MARKER} = '${fence}', 'd') })\n---\n${body}`;
}

const CODE_FENCES = ['js', 'javascript', 'JS', 'JavaScript', ' js ', 'coffee', 'cson'];

function expectNoMarker(): void {
  expect(markers[MARKER]).toBeUndefined();
}

beforeEach(() => {
  delete markers[MARKER];
});

describe('frontmatterFenceLanguage', () => {
  it('reads the language after the opening fence', () => {
    expect(frontmatterFenceLanguage('---\na: 1\n---\n')).toBe('');
    expect(frontmatterFenceLanguage('---yaml\na: 1\n---\n')).toBe('yaml');
    expect(frontmatterFenceLanguage('--- JS \r\na\n---\n')).toBe('js');
    expect(frontmatterFenceLanguage('---js')).toBe('js');
  });

  it('treats a horizontal rule or plain text as no fence', () => {
    expect(frontmatterFenceLanguage('----\ntext')).toBe('');
    expect(frontmatterFenceLanguage('# heading\n---js\n')).toBe('');
  });
});

describe('safe frontmatter wrapper', () => {
  it('parses plain and yaml-labelled fences', () => {
    expect(parseFrontmatter('---\ndescription: hi\n---\nbody\n').data).toEqual({ description: 'hi' });
    expect(parseFrontmatter('---yaml\ndescription: hi\n---\nbody\n').data).toEqual({ description: 'hi' });
    expect(parseFrontmatter('no frontmatter').content).toBe('no frontmatter');
  });

  it.each(CODE_FENCES)('refuses a "---%s" fence without evaluating it', (fence) => {
    expect(() => parseFrontmatter(codeFenced(fence))).toThrow(UnsupportedFrontmatterError);
    expectNoMarker();
  });

  it('refuses non-YAML data fences too', () => {
    expect(() => parseFrontmatter('---json\n{"a": 1}\n---\n')).toThrow(UnsupportedFrontmatterError);
    expect(() => parseFrontmatter('---toml\na = 1\n---\n')).toThrow(UnsupportedFrontmatterError);
  });

  it('refuses through readFrontmatter', () => {
    const dir = join(tmpdir(), `bt-fm-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      const file = join(dir, 'rule.md');
      writeFileSync(file, codeFenced('js'));
      expect(() => readFrontmatter(file)).toThrow(UnsupportedFrontmatterError);
      expectNoMarker();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses through stringifyFrontmatter, which re-parses a string body', () => {
    expect(() => stringifyFrontmatter(codeFenced('js'), { a: 1 })).toThrow(UnsupportedFrontmatterError);
    expectNoMarker();
    expect(stringifyFrontmatter('body\n', { a: 1 })).toBe('---\na: 1\n---\nbody\n');
  });

  it('does not share parsed objects between calls', () => {
    const text = '---\ndescription: hi\n---\nbody\n';
    const first = parseFrontmatter(text);
    first.data.description = 'mutated';
    expect(parseFrontmatter(text).data.description).toBe('hi');
  });
});

describe('entry points refuse code fences', () => {
  it('external-source translation drops the block as body-only', () => {
    const parsed = parseDoc(codeFenced('js', '# kept\n'));
    expectNoMarker();
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe('# kept\n');
    expect(stringifyDoc(parsed.body, { description: 'd' })).toContain('# kept');
  });

  it('legacy skill translation throws instead of evaluating', () => {
    expect(() => toLegacySkillContent(codeFenced('js'), 'x.md', 'prompt')).toThrow();
    expectNoMarker();
  });

  it('agent skill validation reports the frontmatter as invalid', () => {
    expect(agentSkillIssue('x', codeFenced('js'))).toMatch(/frontmatter/);
    expectNoMarker();
  });

  it('skill metadata stamping never evaluates the block', () => {
    try {
      stampSkillMetadata(codeFenced('js'), { name: '@scope/pack', version: '1.0.0', integrity: 'sha512-x' });
    } catch {
      // Refusing is fine; evaluating is not.
    }
    expectNoMarker();
  });
});

describe('sync and why with code-fenced content', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `bt-fm-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    for (const kind of ['rules', 'agents', 'guardrails', 'commands']) {
      mkdirSync(join(root, 'llm', kind), { recursive: true });
    }
    mkdirSync(join(root, 'llm', 'skills', 'evil'), { recursive: true });
    writeFileSync(join(root, 'llm', 'rules', 'evil.md'), codeFenced('js'));
    writeFileSync(join(root, 'llm', 'rules', 'ok.md'), '---\ndescription: ok\n---\n# ok\n');
    writeFileSync(join(root, 'llm', 'agents', 'evil.md'), codeFenced('javascript'));
    writeFileSync(join(root, 'llm', 'guardrails', 'evil.md'), codeFenced('js'));
    writeFileSync(join(root, 'llm', 'commands', 'evil.md'), codeFenced('js'));
    writeFileSync(join(root, 'llm', 'skills', 'evil', 'SKILL.md'), codeFenced('js'));
    writeFileSync(
      join(root, 'bluetemberg.config.json'),
      JSON.stringify({
        platforms: ['claude', 'cursor', 'copilot', 'codex', 'devin', 'gemini'],
        source: 'llm',
      }),
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('sync never evaluates code-fenced frontmatter and still writes clean rules', async () => {
    await sync(root, { silent: true }).catch(() => undefined);
    expectNoMarker();
    const written = listFiles(root).filter((f) => f.endsWith('ok.md') || f.endsWith('ok.mdc'));
    expect(written.length).toBeGreaterThan(0);
  });

  it('why never evaluates code-fenced frontmatter', () => {
    for (const query of ['llm/rules/evil.md', 'llm/guardrails/evil.md', 'llm/skills/evil/SKILL.md']) {
      try {
        buildWhyReport(root, query);
      } catch {
        // Refusing is fine; evaluating is not.
      }
    }
    expectNoMarker();
  });
});

describe('gray-matter is reached only through the wrapper', () => {
  it('no other source module imports gray-matter', () => {
    const offenders = listFiles(join(process.cwd(), 'src'))
      .filter((f) => f.endsWith('.ts') && !f.endsWith(join('utils', 'frontmatter.ts')))
      .filter((f) => /from ['"]gray-matter['"]|require\(['"]gray-matter['"]\)/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}
