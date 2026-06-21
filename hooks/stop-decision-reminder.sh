#!/usr/bin/env bash
# stop-decision-reminder.sh — memory-bank plugin Stop hook.
#
# If the session changed files that memory records anchor, but nothing under
# memory/ was touched, remind the agent ONCE (per session) to record any new
# design decision via /memory-bank:new — or consciously decide none was made.
# Guards: never re-fires when stop_hook_active is set; debounced via a state
# file keyed by session id; silent in repos without memory/.

set -u

INPUT=$(cat 2>/dev/null || true)

emit_continue() { printf '%s\n' '{"continue": true}'; exit 0; }
trap 'emit_continue' ERR

command -v jq   >/dev/null 2>&1 || emit_continue
command -v node >/dev/null 2>&1 || emit_continue

# Never block a stop that is already the product of a stop-hook continuation.
STOP_ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
[ "$STOP_ACTIVE" = "true" ] && emit_continue

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
RECORDS_DIR="$ROOT/memory/records"
[ -d "$RECORDS_DIR" ] || emit_continue

# Debounce: one nudge per session.
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
STATE_FILE="$ROOT/.claude/.memory-stop-nudge"
if [ -n "$SESSION_ID" ] && [ -f "$STATE_FILE" ] && grep -qx "$SESSION_ID" "$STATE_FILE" 2>/dev/null; then
  emit_continue
fi

# NUL-separated porcelain so paths with spaces and rename/copy entries are
# parsed correctly (a plain `awk '{print $NF}'` would mangle them and could
# wrongly suppress the reminder). Each entry is "XY <path>"; rename/copy
# entries are followed by a second NUL field with the original path — emit
# both (over-approximating can only make the reminder fire more readily).
CHANGED=$(cd "$ROOT" && git status --porcelain -z 2>/dev/null | while IFS= read -r -d '' entry; do
  printf '%s\n' "${entry:3}"
  case "$entry" in
    R*|C*) IFS= read -r -d '' orig && printf '%s\n' "$orig" ;;
  esac
done)
[ -z "$CHANGED" ] && emit_continue

# Memory already updated this session → nothing to remind about.
printf '%s\n' "$CHANGED" | grep -q '^memory/' && emit_continue

# Do any changed files fall under a record anchor?
ANCHORS=$(grep -rh --include='*.md' -E '^\s*-?\s*path: ' "$RECORDS_DIR" 2>/dev/null | awk -F'path: *' '
  NF >= 2 {
    p = $2
    gsub(/^[ \x27"]+|[ \x27"]+$/, "", p)
    sub(/[ \t]+#.*$/, "", p)
    if (p != "") print p
  }' | sort -u)
[ -z "$ANCHORS" ] && emit_continue

HITS=$(awk 'NR==FNR { anchors[$0]; next }
  {
    for (a in anchors) {
      if ($0 == a || index($0, a "/") == 1) { print $0; break }
    }
  }' <(printf '%s\n' "$ANCHORS") <(printf '%s\n' "$CHANGED") | sort -u | head -5)
[ -z "$HITS" ] && emit_continue

if [ -n "$SESSION_ID" ]; then
  mkdir -p "$ROOT/.claude" 2>/dev/null || true
  printf '%s\n' "$SESSION_ID" > "$STATE_FILE" 2>/dev/null || true
fi

HITS_ONE_LINE=$(printf '%s' "$HITS" | tr '\n' ' ')
REASON="memory-bank reminder (fires once per session): you changed files anchored by memory records ( ${HITS_ONE_LINE}) but nothing under memory/ was updated. If this session made or changed a design decision, convention, or recorded fact, capture it now: update the affected record or run /memory-bank:new, then run npm run memory:check. If no recorded behaviour changed, say so briefly and finish."

REASON_TEXT="$REASON" node -e 'console.log(JSON.stringify({ decision: "block", reason: process.env.REASON_TEXT }))'
