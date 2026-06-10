import { extract } from 'tar';

/**
 * Cap on total uncompressed bytes across all entries. Translated rule/agent/skill
 * content is tiny; this exists to stop a decompression bomb (small `.tgz`, huge
 * expansion) from filling the disk during extraction.
 */
const DEFAULT_MAX_EXTRACT_BYTES = 100 * 1024 * 1024;

export interface ExtractTarballOptions {
  /** Leading path components to strip. Defaults to 1 (npm + GitHub codeload layout). */
  strip?: number;
  /** Cap on total uncompressed bytes (defaults to {@link DEFAULT_MAX_EXTRACT_BYTES}). */
  maxBytes?: number;
}

/**
 * Reject tarball entries that could escape the destination directory: symlinks/hardlinks
 * (which can point outside after extraction) and any `..` path segment. Exported as a pure
 * function so the security policy is unit-testable without invoking `tar`'s stream.
 *
 * @throws If the entry is unsafe.
 */
export function assertSafeTarEntry(label: string, path: string, type?: string): void {
  const violation = tarEntryViolation(label, path, type);
  if (violation) throw new Error(violation);
}

/**
 * Non-throwing form of {@link assertSafeTarEntry}: returns the violation message, or
 * null when the entry is safe. Used inside the extraction filter, where a thrown
 * error escapes `tar`'s stream as an *unhandled* exception instead of rejecting the
 * returned promise — so we capture the reason and reject cleanly after extraction.
 */
function tarEntryViolation(label: string, path: string, type?: string): string | null {
  if (type === 'SymbolicLink' || type === 'Link') {
    return `Malicious tarball for "${label}": entry "${path}" is a symlink`;
  }
  // Check each segment so `my..file` is not falsely rejected.
  if (path.split('/').some((seg) => seg === '..')) {
    return `Malicious tarball for "${label}": entry "${path}" contains path traversal`;
  }
  return null;
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
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_EXTRACT_BYTES;
  let extracted = 0;
  let violation: string | null = null;

  // `filter` must not throw — a throw escapes tar's stream as an unhandled exception
  // instead of rejecting this promise. Skip the offending entry (return false) and
  // record why, then reject cleanly once extraction has drained.
  await extract({
    file: tmpFile,
    cwd: dest,
    strip: options.strip ?? 1,
    filter: (path, entry) => {
      if (violation) return false;
      // The entry is a ReadEntry during extraction, which has `type` and `size` fields.
      violation = tarEntryViolation(label, path, 'type' in entry ? entry.type : undefined);
      if (violation) return false;
      extracted += 'size' in entry && typeof entry.size === 'number' ? entry.size : 0;
      if (extracted > maxBytes) {
        violation = `Tarball for "${label}" exceeds the maximum extracted size of ${maxBytes} bytes`;
        return false;
      }
      return true;
    },
  });

  if (violation) throw new Error(violation);
}
