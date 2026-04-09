import { describe, it, expect } from 'vitest';
import { parseHooksManifest } from '../src/sync/hooks.js';

describe('parseHooksManifest', () => {
  it('accepts minimal valid manifest', () => {
    const raw = { version: 1, hooks: { beforeSubmitPrompt: [{ command: './scripts/hook.sh' }] } };
    expect(parseHooksManifest(raw)).toEqual({
      version: 1,
      hooks: { beforeSubmitPrompt: [{ command: './scripts/hook.sh' }] },
    });
  });

  it('defaults version to 1 when omitted', () => {
    const raw = { hooks: {} };
    expect(parseHooksManifest(raw)).toEqual({ version: 1, hooks: {} });
  });

  it('rejects non-object root', () => {
    expect(parseHooksManifest(null)).toBeNull();
    expect(parseHooksManifest('x')).toBeNull();
  });

  it('rejects invalid version', () => {
    expect(parseHooksManifest({ version: 0, hooks: {} })).toBeNull();
    expect(parseHooksManifest({ version: '1', hooks: {} })).toBeNull();
  });

  it('rejects hooks that are not an object', () => {
    expect(parseHooksManifest({ hooks: [] })).toBeNull();
    expect(parseHooksManifest({ hooks: 'x' })).toBeNull();
  });

  it('rejects hook list entries without command', () => {
    expect(parseHooksManifest({ hooks: { stop: [{}] } })).toBeNull();
    expect(parseHooksManifest({ hooks: { stop: [{ command: '' }] } })).toBeNull();
  });
});
