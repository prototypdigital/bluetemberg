/**
 * The draft marker (M7 create-loop, #197). A draft carries a `draft:` frontmatter block until a
 * human promotes it with `bluetemberg draft promote`, which writes the rule without that key.
 *
 * Drafts live in `.bluetemberg/drafts/`, which nothing syncs. This marker is the second wall: a
 * draft copied into a source dir by hand is still withheld by sync, guardrails, `why` and the
 * marketplace, because every one of them asks {@link carriesDraftMarker} first. Any `draft` key
 * counts, whatever its value — promotion is the only path that removes it, so `draft: false`
 * cannot be used to slip an unreviewed file through.
 */

export const DRAFT_KEY = 'draft';

/** Why a file carrying the marker is withheld — shown by sync and `why`. */
export const DRAFT_WITHHELD_REASON =
  'unvetted draft (frontmatter `draft:`) — withheld until a human runs `bluetemberg draft promote`';

/** True when `frontmatter` carries the `draft` key (any value). */
export function carriesDraftMarker(frontmatter: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(frontmatter, DRAFT_KEY);
}
