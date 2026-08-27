import { describe, it, expect } from 'vitest';
import {
  injectManagedBlock,
  stripManagedBlock,
  ManagedBlockError,
  AGENTS_RULES_MARKERS,
} from '../src/sync/managed-block.js';

const M = AGENTS_RULES_MARKERS;
const F = 'AGENTS.md';

describe('injectManagedBlock', () => {
  it('creates the block in a missing (null) file', () => {
    expect(injectManagedBlock(null, 'hello', M, F)).toBe(`${M.begin}\nhello\n${M.end}\n`);
  });

  it('returns empty for a missing file with empty inner', () => {
    expect(injectManagedBlock(null, '   ', M, F)).toBe('');
  });

  it('appends the block to existing content, preserving it and ordering it last', () => {
    const out = injectManagedBlock('# Hand authored\n\nbody', 'GEN', M, F);
    expect(out).toContain('# Hand authored');
    expect(out).toContain(`${M.begin}\nGEN\n${M.end}`);
    expect(out.indexOf('# Hand authored')).toBeLessThan(out.indexOf(M.begin));
  });

  it('replaces an existing block, leaving outer content intact', () => {
    const first = injectManagedBlock('HEAD', 'v1', M, F);
    const second = injectManagedBlock(first, 'v2', M, F);
    expect(second).toContain('HEAD');
    expect(second).toContain('v2');
    expect(second).not.toContain('v1');
  });

  it('is idempotent', () => {
    const first = injectManagedBlock('HEAD\n', 'body line', M, F);
    const second = injectManagedBlock(first, 'body line', M, F);
    expect(second).toBe(first);
  });

  it('removes the block when inner becomes empty, keeping outer content', () => {
    const withBlock = injectManagedBlock('HEAD', 'body', M, F);
    const removed = injectManagedBlock(withBlock, '', M, F);
    expect(removed).toBe('HEAD\n');
    expect(removed).not.toContain(M.begin);
  });

  it('leaves a blockless file untouched when inner is empty', () => {
    expect(injectManagedBlock('just content\n', '', M, F)).toBe('just content\n');
  });

  it('replaces a block that sits before hand-authored content, keeping order', () => {
    const existing = `${M.begin}\nv1\n${M.end}\n\n# Tail section\n`;
    const out = injectManagedBlock(existing, 'v2', M, F);
    expect(out).toBe(`${M.begin}\nv2\n${M.end}\n\n# Tail section\n`);
  });
});

describe('injectManagedBlock with malformed markers', () => {
  it('rejects a stray end marker instead of appending a second block', () => {
    const existing = '# My file\n\n' + M.end;
    expect(() => injectManagedBlock(existing, 'GEN', M, F)).toThrow(ManagedBlockError);
    expect(() => injectManagedBlock(existing, 'GEN', M, F)).toThrow(/AGENTS\.md/);
  });

  it('rejects an end marker that precedes the block (endIdx < beginIdx)', () => {
    const existing = `${M.end}\n\n${M.begin}\nv1\n${M.end}\n`;
    expect(() => injectManagedBlock(existing, 'v2', M, F)).toThrow(ManagedBlockError);
  });

  it('rejects a begin marker with no end after it', () => {
    const existing = `# My file\n\n${M.begin}\nhalf a block\n`;
    expect(() => injectManagedBlock(existing, 'GEN', M, F)).toThrow(ManagedBlockError);
  });

  it('rejects a second begin marker nested inside an open block', () => {
    const existing = `${M.begin}\nv1\n${M.begin}\nv2\n${M.end}\n`;
    expect(() => injectManagedBlock(existing, 'v3', M, F)).toThrow(ManagedBlockError);
  });

  it('names the file and points at the repair in the message', () => {
    const err = (() => {
      try {
        injectManagedBlock('x\n' + M.end, 'GEN', M, '.codex/config.toml');
        return null;
      } catch (e) {
        return e as ManagedBlockError;
      }
    })();
    expect(err).toBeInstanceOf(ManagedBlockError);
    expect(err?.message).toContain('.codex/config.toml');
    expect(err?.message).toContain('bluetemberg sync');
  });

  it('collapses duplicated blocks into one, preserving content between them', () => {
    const existing = [
      '# Head',
      '',
      `${M.begin}\nold a\n${M.end}`,
      '',
      'Hand-authored middle.',
      '',
      `${M.begin}\nold b\n${M.end}`,
      '',
      '# Tail',
      '',
    ].join('\n');

    const out = injectManagedBlock(existing, 'fresh', M, F);
    expect(out.match(new RegExp(M.begin, 'g'))?.length).toBe(1);
    expect(out).toContain('# Head');
    expect(out).toContain('Hand-authored middle.');
    expect(out).toContain('# Tail');
    expect(out).toContain('fresh');
    expect(out).not.toContain('old a');
    expect(out).not.toContain('old b');
    // Converged: a second pass is a no-op.
    expect(injectManagedBlock(out, 'fresh', M, F)).toBe(out);
  });

  it('does not grow the file across repeated passes', () => {
    let content = '# My file\n';
    const sizes: number[] = [];
    for (let i = 0; i < 4; i++) {
      content = injectManagedBlock(content, 'GEN', M, F);
      sizes.push(content.length);
    }
    expect(new Set(sizes).size).toBe(1);
  });
});

describe('stripManagedBlock', () => {
  it('removes the fenced region, preserving outer content', () => {
    const withBlock = injectManagedBlock('HEAD', 'body', M, F);
    expect(stripManagedBlock(withBlock, M, F)).toBe('HEAD\n');
  });

  it('is a no-op when markers are absent', () => {
    expect(stripManagedBlock('no markers here\n', M, F)).toBe('no markers here\n');
  });

  it('removes every duplicated block, not just the first', () => {
    const withDuplicates = [
      '# Head',
      '',
      `${M.begin}\ngenerated a\n${M.end}`,
      '',
      'Hand-authored middle.',
      '',
      `${M.begin}\ngenerated b\n${M.end}`,
      '',
      '# Tail',
      '',
    ].join('\n');

    const stripped = stripManagedBlock(withDuplicates, M, F);
    expect(stripped).not.toContain(M.begin);
    expect(stripped).not.toContain(M.end);
    expect(stripped).not.toContain('generated a');
    expect(stripped).not.toContain('generated b');
    expect(stripped).toBe('# Head\n\nHand-authored middle.\n\n# Tail\n');
  });

  it('rejects malformed markers rather than leaking generated content', () => {
    const malformed = `${M.end}\n\n${M.begin}\ngenerated\n${M.end}\n`;
    expect(() => stripManagedBlock(malformed, M, F)).toThrow(ManagedBlockError);
  });
});
