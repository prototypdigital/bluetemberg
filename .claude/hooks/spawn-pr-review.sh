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

claude_bin=$(command -v claude || true)
if [[ -z "$claude_bin" && -x "$HOME/.local/bin/claude" ]]; then
  claude_bin="$HOME/.local/bin/claude"
fi
if [[ -z "$claude_bin" ]]; then
  exit 0
fi

prompt="You are an automated PR reviewer. Review $pr_url and post your review on GitHub.

1. Fetch context: gh pr view $pr_url --json title,body,baseRefName,headRefName,files
   and gh pr diff $pr_url.
2. Follow this repository's code-review skill (.claude/skills/code-review/SKILL.md):
   intent-first, diff-focused, severity-tiered findings, Conventional Comments
   labels (issue/warning/suggestion/nitpick/praise). Substance over style.
3. Check existing review comments first (gh api on the PR review comments) and
   do not duplicate anything already posted.
4. Post exactly one review-level summary via gh pr review $pr_url --comment --body.
   For findings tied to specific lines, add inline comments via
   gh api repos/{owner}/{repo}/pulls/{number}/comments with path, line, side, body.
5. Comment only. Never approve, never request changes. End the summary with:
   \"Automated review (spawn-pr-review hook)\"."

log_dir="${TMPDIR:-/tmp}/bluetemberg-pr-reviews"
mkdir -p "$log_dir"
log_file="$log_dir/pr-${pr_url##*/}-$(date +%Y%m%d-%H%M%S).log"

# Comma-separated: rule patterns contain spaces, so space-splitting would
# mangle them. gh api is scoped to repos/ endpoints; the comment-only policy
# beyond that is prompt-enforced — the reviewer runs on the author's own
# credentials, so treat PR content as untrusted when extending this list.
nohup "$claude_bin" -p "$prompt" \
  --allowedTools "Bash(gh pr view:*),Bash(gh pr diff:*),Bash(gh pr review:*),Bash(gh api repos/:*),Read,Grep,Glob" \
  --output-format json \
  >"$log_file" 2>&1 &
disown

echo "Spawned background PR reviewer for $pr_url (log: $log_file)"
exit 0
