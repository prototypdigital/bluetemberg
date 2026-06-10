import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import { translateRuleContent } from '../src/sources/translate/rules.js';
import { translateDir } from '../src/sources/translate/index.js';

function createTmpDir(): string {
  const dir = join(tmpdir(), `bt-translate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('translateRuleContent — frontmatter mapping', () => {
  it('maps .mdc alwaysApply:true to scope "**"', () => {
    const out = translateRuleContent(
      'x.mdc',
      '---\ndescription: All files\nglobs: "**/*"\nalwaysApply: true\n---\n\nBody\n',
    );
    const { data } = matter(out);
    expect(data).toEqual({ description: 'All files', scope: '**' });
  });

  it('maps .mdc globs array to a scope array', () => {
    const out = translateRuleContent(
      'x.mdc',
      '---\ndescription: TS\nglobs:\n  - "**/*.ts"\n  - "**/*.tsx"\n---\n\nBody\n',
    );
    const { data } = matter(out);
    expect(data).toEqual({ description: 'TS', scope: ['**/*.ts', '**/*.tsx'] });
  });

  it('maps a single-element globs array to a scope string', () => {
    const out = translateRuleContent(
      'x.mdc',
      '---\ndescription: Py\nglobs: ["**/*.py"]\nalwaysApply: false\n---\n\nBody\n',
    );
    const { data } = matter(out);
    expect(data).toEqual({ description: 'Py', scope: '**/*.py' });
  });

  it('synthesizes a description from the first heading for plain .cursorrules', () => {
    const out = translateRuleContent(
      'clean-code.cursorrules',
      '# Clean Code Guidelines\n\nUse constants over magic numbers.\n',
    );
    const { data, content } = matter(out);
    expect(data.description).toBe('Clean Code Guidelines');
    expect(data.scope).toBe('**');
    expect(content).toContain('Use constants over magic numbers');
  });

  it('falls back to a humanized filename when there is no heading or description', () => {
    const out = translateRuleContent('nextjs-app-router.cursorrules', 'Just some prose with no heading.\n');
    const { data } = matter(out);
    expect(data.description).toBe('Nextjs app router');
  });

  it('passes through an already-native rule', () => {
    const out = translateRuleContent(
      'native.md',
      '---\ndescription: Native\nscope: "src/**"\n---\n\nKeep it.\n',
    );
    const { data } = matter(out);
    expect(data).toEqual({ description: 'Native', scope: 'src/**' });
  });

  it('repairs unquoted "globs: **/*" (invalid YAML in many community .mdc files)', () => {
    const out = translateRuleContent(
      'x.mdc',
      '---\ndescription: Repaired\nglobs: **/*\nalwaysApply: true\n---\n\nBody\n',
    );
    const { data } = matter(out);
    expect(data).toEqual({ description: 'Repaired', scope: '**' });
  });

  it('repairs an unquoted glob list', () => {
    const out = translateRuleContent(
      'x.mdc',
      '---\ndescription: List\nglobs:\n  - **/*.ts\n  - **/*.tsx\n---\n\nBody\n',
    );
    const { data } = matter(out);
    expect(data).toEqual({ description: 'List', scope: ['**/*.ts', '**/*.tsx'] });
  });

  it('degrades to body-only when frontmatter is unrepairable', () => {
    const out = translateRuleContent(
      'weird.cursorrules',
      '---\nfoo: : : bad\n  : indent\n---\n\n# Heading\n\nbody\n',
    );
    const { data, content } = matter(out);
    expect(data.description).toBe('Heading');
    expect(content).toContain('body');
  });
});

describe('translateDir — layout routing', () => {
  let root: string;
  let src: string;
  let dest: string;

  beforeEach(() => {
    root = createTmpDir();
    src = join(root, 'src');
    dest = join(root, 'dest');
    mkdirSync(src, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('treats a flat directory as rules and skips README.md', () => {
    writeFileSync(join(src, 'a.mdc'), '---\ndescription: A\nglobs: "**/*"\nalwaysApply: true\n---\n\nA\n');
    writeFileSync(join(src, 'b.cursorrules'), '# B Rule\n\nbody\n');
    writeFileSync(join(src, 'README.md'), '# Readme\n');

    const count = translateDir(src, dest);

    expect(count).toBe(2);
    expect(existsSync(join(dest, 'rules', 'a.md'))).toBe(true);
    expect(existsSync(join(dest, 'rules', 'b.md'))).toBe(true);
    expect(existsSync(join(dest, 'rules', 'README.md'))).toBe(false);
  });

  it('flattens nested rule files with "__"', () => {
    mkdirSync(join(src, 'python'), { recursive: true });
    writeFileSync(join(src, 'python', 'django.mdc'), '---\ndescription: Django\n---\n\nbody\n');

    translateDir(src, dest);

    expect(existsSync(join(dest, 'rules', 'python__django.md'))).toBe(true);
  });

  it('routes a structured layout (rules/agents/skills) by category', () => {
    mkdirSync(join(src, 'rules'), { recursive: true });
    mkdirSync(join(src, 'agents'), { recursive: true });
    mkdirSync(join(src, 'skills', 'api-design'), { recursive: true });
    writeFileSync(join(src, 'rules', 'r.md'), '---\ndescription: R\nscope: "**"\n---\n\nr\n');
    writeFileSync(
      join(src, 'agents', 'reviewer.md'),
      '---\nname: reviewer\ndescription: Reviews\n---\n\nagent\n',
    );
    writeFileSync(
      join(src, 'skills', 'api-design', 'SKILL.md'),
      '---\nname: api-design\ndescription: API\n---\n\nskill\n',
    );

    const count = translateDir(src, dest);

    expect(count).toBe(3);
    expect(existsSync(join(dest, 'rules', 'r.md'))).toBe(true);
    expect(existsSync(join(dest, 'agents', 'reviewer.md'))).toBe(true);
    expect(existsSync(join(dest, 'skills', 'api-design', 'SKILL.md'))).toBe(true);
  });

  it('injects a skill name into SKILL.md when missing', () => {
    mkdirSync(join(src, 'skills', 'my-skill'), { recursive: true });
    writeFileSync(join(src, 'skills', 'my-skill', 'SKILL.md'), '---\ndescription: No name\n---\n\nbody\n');

    translateDir(src, dest);

    const { data } = matter(readFileSync(join(dest, 'skills', 'my-skill', 'SKILL.md'), 'utf8'));
    expect(data.name).toBe('my-skill');
  });

  it('returns 0 for a non-existent source dir', () => {
    expect(translateDir(join(root, 'nope'), dest)).toBe(0);
  });
});
