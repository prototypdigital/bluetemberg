#!/usr/bin/env bash
# Read-only PR context fetcher used by the spawned PR reviewer.
# Structural boundary: the reviewer's --allowedTools grants THIS script
# instead of raw `gh pr view` / `gh pr diff`. Those two are read-only, but
# unrestricted they still let a prompt-injected diff use the developer's own
# authenticated `gh` session to read an unrelated private PR — and whatever
# gets read can end up quoted into the one write path the reviewer has
# (post-review-comment.sh), on the PR actually being reviewed. EXPECTED_PR_URL
# (required, set by run-pr-review.sh) pins every read to that one PR, the same
# way post-review-comment.sh pins every write.
# https://github.com/prototypdigital/bluetemberg-packs/pull/111
set -euo pipefail

usage() {
  {
    echo "usage: EXPECTED_PR_URL=<pr-url> read-pr-context.sh <pr-url> view"
    echo "       EXPECTED_PR_URL=<pr-url> read-pr-context.sh <pr-url> diff"
    echo "       EXPECTED_PR_URL=<pr-url> read-pr-context.sh <pr-url> comments"
  } >&2
  exit 1
}

[[ $# -eq 2 ]] || usage
pr_url=$1
action=$2

url_re='^https://github\.com/([^/]+)/([^/]+)/pull/([0-9]+)$'
[[ "$pr_url" =~ $url_re ]] || usage
owner=${BASH_REMATCH[1]}
repo=${BASH_REMATCH[2]}
number=${BASH_REMATCH[3]}

# EXPECTED_PR_URL is set by the trusted wrapper (run-pr-review.sh), never by
# the reviewed diff or the model's prompt. A prompt-injected review could
# still try to pass a different <pr-url> to read another PR — refuse unless
# it matches what the wrapper actually invoked us for.
if [[ "${EXPECTED_PR_URL:-}" != "$pr_url" ]]; then
  echo "read-pr-context.sh: refusing — <pr-url> ($pr_url) does not match EXPECTED_PR_URL (${EXPECTED_PR_URL:-unset})" >&2
  exit 1
fi

case "$action" in
  view)
    exec gh pr view "$number" --repo "$owner/$repo" --json title,body,baseRefName,headRefName,files,commits
    ;;
  diff)
    exec gh pr diff "$number" --repo "$owner/$repo"
    ;;
  comments)
    exec gh pr view "$number" --repo "$owner/$repo" --comments
    ;;
  *)
    usage
    ;;
esac
