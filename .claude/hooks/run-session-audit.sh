#!/usr/bin/env bash
# Detached worker for spawn-session-audit.sh. Two-tier audit of one session:
#   1. deterministic pass — jq/awk stats straight off the transcript (free)
#   2. judge pass — a cheap headless model grades harness usage from the
#      stats + truncated user prompts (never the raw JSONL: cost + size)
# Output: .claude/retrospectives/<session-id>.md (gitignored — retros are a
# local ledger; findings graduate into llm/rules/ only via human triage).
#
# The transcript JSONL format is officially internal and version-unstable —
# every extraction below is defensive (`// empty`, `|| true`) and degrades to
# partial stats rather than failing the audit.
# https://github.com/prototypdigital/bluetemberg/issues/229
set -euo pipefail

transcript=$1
session_id=$2
cwd=$3

command -v jq >/dev/null 2>&1 || exit 0

claude_bin=$(command -v claude || true)
if [[ -z "$claude_bin" && -x "$HOME/.local/bin/claude" ]]; then
  claude_bin="$HOME/.local/bin/claude"
fi
if [[ -z "$claude_bin" ]]; then
  exit 0
fi

# Retrospectives can contain prompt content — keep them private to the user.
umask 077
retro_dir="$cwd/.claude/retrospectives"
mkdir -p "$retro_dir"
retro="$retro_dir/$session_id.md"
if [[ -f "$retro" ]]; then
  exit 0
fi

log_dir="${TMPDIR:-/tmp}/bluetemberg-session-audits"
mkdir -p "$log_dir"
log_file="$log_dir/$session_id.log"

# --- Tier 1: deterministic stats -------------------------------------------

tokens_by_model=$(jq -r '
  select(.type? == "assistant") | .message as $m
  | select($m.usage != null)
  | "\($m.model // "unknown") \($m.usage.input_tokens // 0) \($m.usage.output_tokens // 0) \($m.usage.cache_read_input_tokens // 0)"
' "$transcript" 2>>"$log_file" |
  awk '{inp[$1]+=$2; out[$1]+=$3; cache[$1]+=$4; n[$1]++}
       END {for (m in n) printf "- %s: %d requests, %d input / %d output / %d cache-read tokens\n", m, n[m], inp[m], out[m], cache[m]}' || true)

tool_histogram=$(jq -r '
  select(.type? == "assistant") | .message.content[]?
  | select(.type? == "tool_use") | .name // empty
' "$transcript" 2>>"$log_file" | sort | uniq -c | sort -rn | head -15 || true)

repeated_reads=$(jq -r '
  select(.type? == "assistant") | .message.content[]?
  | select(.type? == "tool_use" and .name == "Read") | .input.file_path // empty
' "$transcript" 2>>"$log_file" | sort | uniq -c | sort -rn | awk '$1 > 1' | head -10 || true)

error_count=$(jq -r '
  select(.type? == "user") | .message.content[]?
  | select(.type? == "tool_result" and .is_error == true) | "e"
' "$transcript" 2>>"$log_file" | wc -l | tr -d ' ' || true)

user_prompts=$(jq -r '
  select(.type? == "user") | .message.content
  | if type == "string" then .
    elif type == "array" then ([.[]? | select(.type? == "text") | .text] | join(" "))
    else empty end
  | select(length > 0)
' "$transcript" 2>>"$log_file" | grep -v '^<' | cut -c1-300 | head -20 || true)

stats="### Tokens by model
${tokens_by_model:-unavailable}

### Tool-call histogram (count, tool)
${tool_histogram:-unavailable}

### Files Read more than once (count, path)
${repeated_reads:-none}

### Tool errors
${error_count:-0}"

# --- Tier 2: judge pass ------------------------------------------------------

prompt="You are a session auditor for Claude Code sessions. Below are deterministic
statistics and truncated user prompts from a completed session in the repository
at $cwd. Audit HOW the session used the harness — not what it built.

Produce markdown with exactly these sections:
## Grade
One letter A-F with a one-sentence justification.
## What went well
Up to 3 bullets, each grounded in the data below.
## Waste and anti-patterns
Bullets for: repeated reads of the same file, tool errors and retries,
Bash used where a dedicated tool exists, work that should have been
delegated to subagents, and token-heavy models used for mechanical steps.
Only claim what the data supports; if the data is inconclusive, say so.
## Three concrete improvements
Numbered, each one actionable in the next session (a habit, a hook, a skill,
or a delegation pattern — not vague advice).

=== DETERMINISTIC STATS ===
$stats

=== USER PROMPTS (each truncated to 300 chars, max 20) ===
${user_prompts:-unavailable}"

# JSON output is the only reliable success signal — and even there, an auth
# failure reports subtype "success" with the error text in .result; only
# .is_error distinguishes a real judgment from a failure message. Exit status
# and non-empty stdout both lie (claude exits 0 on auth failure).
judge_out=$("$claude_bin" -p "$prompt" --model haiku --output-format json 2>>"$log_file" || true)
judged=$(jq -er 'select(.is_error == false) | .result // empty' <<<"$judge_out" 2>/dev/null || true)
judge_cost=$(jq -er 'select(.is_error == false) | .total_cost_usd // empty' <<<"$judge_out" 2>/dev/null || true)

# --- Write the retrospective -------------------------------------------------

{
  echo "# Session retrospective — $session_id"
  echo
  echo "- Date: $(date '+%Y-%m-%d %H:%M')"
  echo "- Project: $cwd"
  echo "- Transcript: $transcript"
  echo
  echo "$stats"
  echo
  if [[ -n "$judged" ]]; then
    echo "$judged"
    echo
    if [[ -n "$judge_cost" ]]; then
      printf '_Audit cost: $%.4f (haiku judge)._\n' "$judge_cost"
    fi
  else
    echo "_Judge pass failed — deterministic stats only. See $log_file._"
    printf '%s\n' "$judge_out" >>"$log_file"
  fi
} >"$retro"

exit 0
