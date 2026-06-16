import { describe, it, expect } from 'vitest';
import { renderUnifiedDiff } from '../src/sync/diff.js';

describe('renderUnifiedDiff', () => {
  it('summarizes added and removed line counts', () => {
    const out = renderUnifiedDiff('a\nb\nc', 'a\nB\nc\nd');
    expect(out[0]).toContain('2 line(s) added');
    expect(out[0]).toContain('1 line(s) removed');
  });

  it('emits a unified hunk header and +/- lines for the changed content', () => {
    const out = renderUnifiedDiff('a\nold\nc', 'a\nnew\nc').join('\n');
    expect(out).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(out).toContain('-old');
    expect(out).toContain('+new');
    expect(out).toContain(' a');
    expect(out).toContain(' c');
  });

  it('treats a null existing side as a brand-new file', () => {
    const out = renderUnifiedDiff(null, 'line1\nline2');
    expect(out[0]).toContain('new file');
    expect(out).toContain('    +line1');
    expect(out).toContain('    +line2');
  });

  it('collapses unchanged runs into separate hunks', () => {
    const a = ['x', ...Array(20).fill('same'), 'y'].join('\n');
    const b = ['X', ...Array(20).fill('same'), 'Y'].join('\n');
    const headers = renderUnifiedDiff(a, b).filter((l) => l.includes('@@'));
    expect(headers.length).toBe(2);
  });
});
