#!/usr/bin/env bash
# PostToolUse hook (matcher: Bash). When the completed command was `gh pr create`,
# detach a headless Claude session that reviews the new PR and posts comments.
# PostToolUse hooks block the authoring session's turn, so this script must
# hand off and exit 0 immediately; the reviewer runs in the background.
# https://github.com/prototypdigital/bluetemberg/issues/224
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)

cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
pr_create_re='(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$)'
if ! [[ "$cmd" =~ $pr_create_re ]]; then
  exit 0
fi

# A successful gh pr create prints the PR URL; no URL in the response means
# the command failed or only mentioned "gh pr create" — spawn nothing.
pr_url=$(jq -r '.tool_response | tostring' <<<"$input" |
  grep -oE 'https://github\.com/[^/[:space:]"\\]+/[^/[:space:]"\\]+/pull/[0-9]+' |
  head -1 || true)

if [[ -z "$pr_url" ]]; then
  exit 0
fi

# All real work — reviewer session, then the post-hoc cost comment — lives in
# the detached worker; this hook only gates and hands off.
hook_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
nohup "$hook_dir/run-pr-review.sh" "$pr_url" >/dev/null 2>&1 &
disown

echo "Spawned background PR reviewer for $pr_url (logs: ${TMPDIR:-/tmp}/bluetemberg-pr-reviews)"
exit 0
