#!/usr/bin/env bash
# SessionEnd hook: detach a background session audit (token spend + harness
# quality) for the session that just ended. SessionEnd hooks run while the
# process is exiting and share a tight time budget, so this script only
# gates and detaches — all analysis happens in run-session-audit.sh.
# https://github.com/prototypdigital/bluetemberg/issues/229
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)

# /clear ends a session the user is deliberately restarting — auditing the
# discarded half produces noise, not signal.
reason=$(jq -r '.reason // empty' <<<"$input")
if [[ "$reason" == "clear" ]]; then
  exit 0
fi

transcript=$(jq -r '.transcript_path // empty' <<<"$input")
session_id=$(jq -r '.session_id // empty' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")
if [[ -z "$transcript" || ! -f "$transcript" || -z "$session_id" || -z "$cwd" ]]; then
  exit 0
fi

# Dedupe: one retrospective per session.
if [[ -f "$cwd/.claude/retrospectives/$session_id.md" ]]; then
  exit 0
fi

hook_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
nohup "$hook_dir/run-session-audit.sh" "$transcript" "$session_id" "$cwd" >/dev/null 2>&1 &
disown

exit 0
