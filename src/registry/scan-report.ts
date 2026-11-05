import { existsSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { formatFinding, sanitizeForTerminal, scanPackContent } from './scanner.js';
import type { ScanFinding } from './scanner.js';

/**
 * `bluetemberg scan <dir...>`: the install-time content scan, run on local pack or source dirs. A
 * packs repo runs it in CI on every PR, so a blocking pattern is caught before it is published
 * rather than at a consumer's install. Pure: builds data; the CLI prints it.
 */
export interface ContentScanEntry {
  /** The dir as given, relative to the working directory. */
  path: string;
  filesScanned: number;
  findings: ScanFinding[];
}

export interface ContentScanReport {
  entries: ContentScanEntry[];
  blocks: number;
  warnings: number;
}

/** Scan each dir. Throws for a path that is missing or not a directory. */
export function buildContentScanReport(dirs: readonly string[], cwd = process.cwd()): ContentScanReport {
  const entries = dirs.map((dir): ContentScanEntry => {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`Not a directory: ${dir}`);
    const { filesScanned, findings } = scanPackContent(dir);
    return { path: sanitizeForTerminal(relative(cwd, dir) || '.'), filesScanned, findings };
  });
  const all = entries.flatMap((e) => e.findings);
  return {
    entries,
    blocks: all.filter((f) => f.severity === 'block').length,
    warnings: all.filter((f) => f.severity === 'warn').length,
  };
}

/** Human-readable report: one block per dir with findings, then a totals line. */
export function formatContentScanReport(report: ContentScanReport): string[] {
  const lines: string[] = [];
  for (const entry of report.entries) {
    if (entry.findings.length === 0) continue;
    lines.push(`${entry.path}:`);
    // Every finding, uncapped: this runs on content the user is reviewing, not on a hostile download.
    for (const f of entry.findings)
      lines.push(`  ${f.severity === 'block' ? 'BLOCK' : 'warn '} ${formatFinding(f)}`);
  }
  const files = report.entries.reduce((n, e) => n + e.filesScanned, 0);
  lines.push(
    `Scanned ${report.entries.length} dir(s), ${files} file(s): ${report.blocks} blocking, ${report.warnings} warning(s).`,
  );
  return lines;
}
