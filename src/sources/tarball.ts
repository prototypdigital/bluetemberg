import { extract } from 'tar';

export interface ExtractTarballOptions {
  /** Leading path components to strip. Defaults to 1 (npm + GitHub codeload layout). */
  strip?: number;
}

/**
 * Reject tarball entries that could escape the destination directory: symlinks/hardlinks
 * (which can point outside after extraction) and any `..` path segment. Exported as a pure
 * function so the security policy is unit-testable without invoking `tar`'s stream.
 *
 * @throws If the entry is unsafe.
 */
export function assertSafeTarEntry(label: string, path: string, type?: string): void {
  if (type === 'SymbolicLink' || type === 'Link') {
    throw new Error(`Malicious tarball for "${label}": entry "${path}" is a symlink`);
  }
  // Check each segment so `my..file` is not falsely rejected.
  if (path.split('/').some((seg) => seg === '..')) {
    throw new Error(`Malicious tarball for "${label}": entry "${path}" contains path traversal`);
  }
}

/**
 * Extract a tarball safely using the `tar` npm package.
 *
 * Strips the top-level wrapper dir (npm `package/`, GitHub `repo-ref/`) and rejects
 * symlinks and entries with path traversal (`..`) to prevent escape from the
 * destination directory. Shared by the npm pack installer and the external-source
 * adapters so there is a single audited extraction boundary.
 *
 * Using `tar` instead of system `tar` ensures cross-platform support (Windows,
 * minimal containers) and per-entry security filtering.
 *
 * @param tmpFile - Path to the downloaded `.tgz`.
 * @param dest - Directory to extract into (must exist).
 * @param label - Human-readable source name, used in error messages.
 */
export async function extractTarball(
  tmpFile: string,
  dest: string,
  label: string,
  options: ExtractTarballOptions = {},
): Promise<void> {
  await extract({
    file: tmpFile,
    cwd: dest,
    strip: options.strip ?? 1,
    filter: (path, entry) => {
      // The entry is a ReadEntry during extraction, which has a `type` field.
      assertSafeTarEntry(label, path, 'type' in entry ? entry.type : undefined);
      return true;
    },
  });
}
