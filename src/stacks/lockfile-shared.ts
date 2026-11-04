/** Helpers shared by the lockfile readers (`lockfile.ts`, `lockfile-pnpm.ts`, `lockfile-yarn.ts`). */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The npm package name a `name@…` string starts with (scope-aware), or null when there is none. */
export function leadingPackageName(spec: string): string | null {
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
  return at > 0 ? spec.slice(0, at) : null;
}

/**
 * The plain range `pkg` declares, unwrapping the protocols that name a package: `npm:^18` and
 * `npm:react@^18` are react's `^18`; berry's `patch:react@npm%3A^18#…` wraps the same thing. null
 * when the range installs a different package (`npm:preact@10.19.0`, or a patch of one) — so it
 * is never read as `pkg`'s version.
 */
export function ownRange(pkg: string, range: string): string | null {
  if (range.startsWith('patch:')) {
    let inner: string;
    try {
      inner = decodeURIComponent(range.slice('patch:'.length).split('#')[0]);
    } catch {
      return null;
    }
    const name = leadingPackageName(inner);
    return name === pkg ? ownRange(pkg, inner.slice(name.length + 1)) : null;
  }
  if (!range.startsWith('npm:')) return range;
  const target = range.slice('npm:'.length);
  const name = leadingPackageName(target);
  if (name === null) return target;
  return name === pkg ? target.slice(name.length + 1) : null;
}

/** `npm:other@1.0.0` (or a patch of it) installs a different package; `npm:^1.0.0` does not. */
export function aliasesOtherPackage(pkg: string, range: string): boolean {
  return ownRange(pkg, range) === null;
}
