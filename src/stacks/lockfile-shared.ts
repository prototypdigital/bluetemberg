/** Helpers shared by the lockfile readers (`lockfile.ts`, `lockfile-pnpm.ts`, `lockfile-yarn.ts`). */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The npm package name a `name@…` string starts with (scope-aware), or null when there is none. */
export function leadingPackageName(spec: string): string | null {
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
  return at > 0 ? spec.slice(0, at) : null;
}

/** `npm:other@1.0.0` aliases a different package; `npm:^1.0.0` and `npm:same@1` do not. */
export function aliasesOtherPackage(pkg: string, range: string): boolean {
  if (!range.startsWith('npm:')) return false;
  const name = leadingPackageName(range.slice(4));
  return name !== null && name !== pkg;
}
