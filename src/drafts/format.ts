import type { GapBrief } from './brief.js';
import type { DraftCheckReport } from './check.js';
import type { DraftListEntry, NewDraftResult } from './draft.js';
import type { PromotionReview, PromoteResult } from './promote.js';

/** Human-readable lines for the `draft` commands. Pure — the CLI prints them. */

export function formatBrief(brief: GapBrief): string[] {
  const { stack, version, kind, detected, confidence, source } = brief.gap;
  const lines = brief.warnings.map((w) => `WARN: ${w}`);
  lines.push(`${stack}@${version} — ${brief.fillable ? `gap (${kind})` : 'not a gap'}`);
  if (brief.refusal) {
    lines.push(`  ${brief.refusal}`);
    return lines;
  }
  lines.push(
    `  detected: ${detected ? `yes, ${confidence} from ${source}` : 'no (named by hand or from scan-org)'}`,
    `  package: ${brief.package}`,
    `  proposed range: ${brief.proposedRange}`,
    `  covered ranges: ${brief.coverage.coveredRanges.join(', ') || '(none)'}`,
  );
  const nearest = [...brief.nearestGuidance.ranged, ...brief.nearestGuidance.nameLevel];
  if (nearest.length > 0) {
    lines.push('  nearest guidance:');
    for (const n of nearest) lines.push(`    ${n.from}  ${n.stack}: "${n.range}"`);
  }
  lines.push(`  evidence (${brief.evidence.files.length} file(s) import ${brief.package}):`);
  for (const f of brief.evidence.files) lines.push(`    ${f}`);
  if (brief.evidence.truncated) lines.push('    … (capped)');
  lines.push('  next steps:');
  for (const step of brief.authoring.steps) lines.push(`    - ${step}`);
  return lines;
}

export function formatNewDraft(result: NewDraftResult): string[] {
  return [
    `Draft opened: ${result.path}`,
    `  ${result.brief.gap.stack}@${result.brief.gap.version} (${result.brief.gap.kind}), range ${result.brief.proposedRange}`,
    '  Fill it in (create-rule house structure + citations), then run:',
    `    bluetemberg draft check ${result.name}`,
  ];
}

export function formatList(entries: DraftListEntry[]): string[] {
  if (entries.length === 0) return ['No drafts in .bluetemberg/drafts/.'];
  return entries.map((e) => {
    const gap = e.gap ? `${e.gap.stack}@${e.gap.version}` : '(no gap recorded)';
    const reviewed = e.reviewedBy ? `, reviewed by ${e.reviewedBy}` : '';
    return `  ${e.status.padEnd(10)} ${e.name}  ${gap}  ${e.citations} citation(s)${reviewed}`;
  });
}

export function formatCheck(report: DraftCheckReport): string[] {
  const lines = [
    `${report.path}: ${report.ok ? 'OK — ready for human review' : `${report.errors.length} error(s)`}`,
  ];
  for (const e of report.errors) lines.push(`  ✗ [${e.code}] ${e.message}`);
  for (const w of report.warnings) lines.push(`  ! [${w.code}] ${w.message}`);
  if (report.ok)
    lines.push(`  A human promotes it with: bluetemberg draft promote ${report.name} --reviewed-by <name>`);
  return lines;
}

export function formatReview(review: PromotionReview): string[] {
  const rule = '─'.repeat(72);
  const lines = [
    `Promote draft "${review.name}" for ${review.gap.stack}@${review.gap.version}`,
    `  will write: ${review.destination}`,
    `  sha256 of the reviewed draft: ${review.sha256}`,
    '  citations:',
    ...review.citations.map((c) => `    - ${c.url} (retrieved ${c.retrieved})\n      "${c.quote}"`),
  ];
  for (const w of review.warnings) lines.push(`  ! [${w.code}] ${w.message}`);
  lines.push(rule, review.output.trimEnd(), rule);
  lines.push('Read the whole rule above. It will be loaded into every AI session that matches its scope.');
  return lines;
}

export function formatPromoted(result: PromoteResult): string[] {
  if (!result.promoted) return [`Not promoted. "${result.name}" stays a draft.`];
  return [
    `Promoted ${result.name} → ${result.destination}`,
    `  archived: ${result.archived}`,
    '  Run `bluetemberg sync` to apply it.',
  ];
}
