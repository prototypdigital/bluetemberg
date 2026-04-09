import type { AdapterContext, AdapterRecordError, AdapterRunFn } from './adapter-contract.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Narrows a runtime `function` to {@link AdapterRunFn}. TypeScript cannot prove the parameter
 * types or arity for values loaded via `import()`; the contract is documented on
 * {@link AdapterContext} and enforced by tests, not at runtime.
 */
function toAdapterRunFn(fn: unknown): AdapterRunFn | null {
  if (typeof fn !== 'function') return null;
  return fn as AdapterRunFn;
}

export function resolveAdapterRun(exported: unknown): AdapterRunFn | null {
  const direct = toAdapterRunFn(exported);
  if (direct) return direct;

  if (!isPlainObject(exported)) return null;

  return toAdapterRunFn(exported.run);
}

export async function runOptionalAdapters(
  ctx: AdapterContext,
  recordError: AdapterRecordError,
): Promise<void> {
  const specifiers = ctx.config.adapters;
  if (!specifiers?.length) return;

  for (const specifier of specifiers) {
    if (typeof specifier !== 'string' || specifier.length === 0) {
      recordError('adapters: each entry must be a non-empty string (package name or file URL)');
      continue;
    }

    try {
      const mod = await import(specifier);
      const run = resolveAdapterRun(mod.default ?? mod);
      if (!run) {
        recordError(`adapter "${specifier}": expected default function or default object with run() method`);
        continue;
      }
      await run(ctx, recordError);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordError(`adapter "${specifier}": ${message}`);
    }
  }
}
