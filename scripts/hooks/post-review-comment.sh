#!/usr/bin/env bash
# Comment-only GitHub review poster used by the spawned PR reviewer.
# Structural boundary: the reviewer's --allowedTools grants THIS script instead
# of gh api / gh pr review, so approve, request-changes, merge, and arbitrary
# API access stay impossible no matter what the reviewed diff prompts the
# model into. EXPECTED_PR_URL (required, set by run-pr-review.sh) additionally
# pins every call to the one PR being reviewed, so a prompt-injected diff
# cannot redirect comments to another PR in the repo.
# https://github.com/prototypdigital/bluetemberg/issues/224
set -euo pipefail

usage() {
  {
    echo "usage: EXPECTED_PR_URL=<pr-url> post-review-comment.sh <pr-url> list"
    echo "       EXPECTED_PR_URL=<pr-url> post-review-comment.sh <pr-url> summary <body>"
    echo "       EXPECTED_PR_URL=<pr-url> post-review-comment.sh <pr-url> inline <path> <line> <body>"
  } >&2
  exit 1
}

[[ $# -ge 2 ]] || usage
pr_url=$1
action=$2

url_re='^https://github\.com/([^/]+)/([^/]+)/pull/([0-9]+)$'
[[ "$pr_url" =~ $url_re ]] || usage
owner=${BASH_REMATCH[1]}
repo=${BASH_REMATCH[2]}
number=${BASH_REMATCH[3]}

# EXPECTED_PR_URL is set by the trusted wrapper (run-pr-review.sh), never by
# the reviewed diff or the model's prompt. A prompt-injected review could
# still try to pass a different <pr-url> to reach another PR in the repo —
# refuse unless it matches what the wrapper actually invoked us for.
if [[ "${EXPECTED_PR_URL:-}" != "$pr_url" ]]; then
  echo "post-review-comment.sh: refusing — <pr-url> ($pr_url) does not match EXPECTED_PR_URL (${EXPECTED_PR_URL:-unset})" >&2
  exit 1
fi

case "$action" in
  list)
    [[ $# -eq 2 ]] || usage
    exec gh api "repos/$owner/$repo/pulls/$number/comments" --paginate
    ;;
  summary)
    [[ $# -eq 3 ]] || usage
    exec gh pr review "$number" --repo "$owner/$repo" --comment --body "$3"
    ;;
  inline)
    [[ $# -eq 5 ]] || usage
    commit_id=$(gh pr view "$number" --repo "$owner/$repo" --json headRefOid -q .headRefOid)
    exec gh api "repos/$owner/$repo/pulls/$number/comments" \
      -f body="$5" -f commit_id="$commit_id" -f path="$3" -F line="$4" -f side=RIGHT
    ;;
  *)
    usage
    ;;
esac
