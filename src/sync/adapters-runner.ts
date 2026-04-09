import type { AdapterContext, AdapterRecordError, AdapterRunFn } from './adapter-contract.js';

export function resolveAdapterRun(exported: unknown): AdapterRunFn | null {
  if (typeof exported === 'function') {
    return exported as AdapterRunFn;
  }
  if (exported !== null && typeof exported === 'object') {
    const run = (exported as { run?: unknown }).run;
    if (typeof run === 'function') {
      return run as AdapterRunFn;
    }
  }
  return null;
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
