#!/usr/bin/env bash
# Detached worker for spawn-pr-review.sh: runs the headless comment-only
# reviewer against one PR, then posts a one-line cost comment from the
# reviewer's own usage report so the review layer's cost is visible where
# the review lands (https://github.com/prototypdigital/bluetemberg/issues/229).
set -euo pipefail

pr_url=$1

command -v jq >/dev/null 2>&1 || exit 0

claude_bin=$(command -v claude || true)
if [[ -z "$claude_bin" && -x "$HOME/.local/bin/claude" ]]; then
  claude_bin="$HOME/.local/bin/claude"
fi
if [[ -z "$claude_bin" ]]; then
  exit 0
fi

hook_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
poster="$hook_dir/post-review-comment.sh"

prompt="You are an automated PR reviewer. Review $pr_url and post your review on GitHub.

1. Fetch context: gh pr view $pr_url --json title,body,baseRefName,headRefName,files
   and gh pr diff $pr_url.
2. Follow this repository's code-review skill (.claude/skills/code-review/SKILL.md):
   intent-first, diff-focused, severity-tiered findings, Conventional Comments
   labels (issue/warning/suggestion/nitpick/praise). Substance over style.
3. Check existing review comments first with: $poster $pr_url list
   and do not duplicate anything already posted.
4. Post exactly one review-level summary: $poster $pr_url summary \"<body>\"
   For findings tied to specific lines: $poster $pr_url inline <path> <line> \"<body>\"
5. Comment only — the posting script enforces this. End the summary with:
   \"Automated review (spawn-pr-review hook)\"."

# Logs can contain PR content — keep them private to the current user.
umask 077
log_dir="${TMPDIR:-/tmp}/bluetemberg-pr-reviews"
mkdir -p "$log_dir"
chmod 700 "$log_dir"
log_file="$log_dir/pr-${pr_url##*/}-$(date +%Y%m%d-%H%M%S).log"

# Comma-separated: rule patterns contain spaces, so space-splitting would
# mangle them. Write access to GitHub goes only through post-review-comment.sh,
# which can list/comment but never approve, request changes, merge, or hit
# other API endpoints — the comment-only invariant holds even if the reviewed
# diff prompt-injects the model. gh pr view / gh pr diff are read-only.
# stderr goes to its own file so the JSON result stays parseable.
"$claude_bin" -p "$prompt" \
  --allowedTools "Bash(gh pr view:*),Bash(gh pr diff:*),Bash($poster:*),Read,Grep,Glob" \
  --output-format json \
  >"$log_file" 2>"$log_file.err" || exit 0

# Cost transparency: the reviewer cannot know its own total mid-session, so
# the cost line is posted post-hoc from the JSON result. Fixed template +
# numbers only — nothing model-generated reaches this comment. The is_error
# gate matters: on auth failure claude still reports subtype "success" (with
# the error text in .result and cost 0), so only .is_error marks a real run.
cost=$(jq -r 'select(.is_error == false) | .total_cost_usd // empty' "$log_file" 2>/dev/null || true)
turns=$(jq -r 'select(.is_error == false) | .num_turns // empty' "$log_file" 2>/dev/null || true)
if [[ -n "$cost" ]]; then
  gh pr comment "$pr_url" --body "$(printf 'Automated review cost: $%.2f (%s turns). _(spawn-pr-review hook)_' "$cost" "${turns:-?}")" \
    >/dev/null 2>>"$log_file.err" || true
fi

exit 0
