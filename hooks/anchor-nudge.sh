#!/usr/bin/env bash
# anchor-nudge.sh — memory-bank plugin PostToolUse hook (Edit|Write|MultiEdit).
#
# When an edited file is anchored by one or more memory records, emit a soft
# nudge naming the record IDs + rules so the agent re-checks the recorded
# decision/convention before (or right after) changing behaviour.
#
# Record-driven: matching is done against `path:` anchor lines in
# memory/records/**/*.md — no hardcoded file lists. Pure bash/awk (no tsx
# startup cost on every edit). Never blocks.

set -u

INPUT=$(cat 2>/dev/null || true)

emit_continue() { printf '%s\n' '{"continue": true}'; exit 0; }
trap 'emit_continue' ERR

command -v jq   >/dev/null 2>&1 || emit_continue
command -v node >/dev/null 2>&1 || emit_continue

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null)
[ -z "$FILE_PATH" ] && emit_continue

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
RECORDS_DIR="$ROOT/memory/records"
[ -d "$RECORDS_DIR" ] || emit_continue

REL="$FILE_PATH"
case "$FILE_PATH" in "$ROOT"/*) REL="${FILE_PATH#$ROOT/}" ;; esac

# Don't nudge on edits to the memory bank itself.
case "$REL" in memory/*) emit_continue ;; esac

# Find records whose anchors cover this file (exact path or directory prefix).
# Anchor lines look like:   - path: packages/foo/bar.ts   (optionally quoted)
MATCHED_FILES=$(grep -rH --include='*.md' -E '^\s*-?\s*path: ' "$RECORDS_DIR" 2>/dev/null | awk -v rel="$REL" '
  {
    i = index($0, ":")
    if (i == 0) next
    file = substr($0, 1, i - 1)
    rest = substr($0, i + 1)
    if (!sub(/^[ \t-]*path:[ \t]*/, "", rest)) next
    sub(/[ \t]+#.*$/, "", rest)
    gsub(/^[\x27"]+|[\x27"]+$/, "", rest)
    if (rest != "" && (rel == rest || index(rel, rest "/") == 1)) print file
  }' | sort -u)

[ -z "$MATCHED_FILES" ] && emit_continue

# Pull id + rule from each matched record's frontmatter (limit 5).
NUDGE_LINES=""
COUNT=0
while IFS= read -r rec_file; do
  [ -z "$rec_file" ] && continue
  STATUS=$(awk -F': *' '/^status:/ { print $2; exit }' "$rec_file" 2>/dev/null)
  case "$STATUS" in active*) ;; *) continue ;; esac
  ID=$(awk -F': *' '/^id:/ { print $2; exit }' "$rec_file" 2>/dev/null)
  RULE=$(awk '/^rule:/ { sub(/^rule: */, ""); gsub(/^["\x27]|["\x27]$/, ""); print; exit }' "$rec_file" 2>/dev/null)
  [ -z "$ID" ] && continue
  NUDGE_LINES="${NUDGE_LINES}│   ${ID}: ${RULE}"$'\n'
  COUNT=$((COUNT + 1))
  [ "$COUNT" -ge 5 ] && break
done <<< "$MATCHED_FILES"

[ "$COUNT" -eq 0 ] && emit_continue

banner=$'\n'"┌─────────────────────────────────────────────────────────────────┐"$'\n'
banner+="│ 📚  MEMORY ANCHOR NUDGE"$'\n'
banner+="│ File: $REL is anchored by $COUNT memory record(s):"$'\n'
banner+="$NUDGE_LINES"
banner+="│ If your change alters recorded behaviour: update the record"$'\n'
banner+="│ (memory/records/…) or run /memory-bank:review. Counts asserted by"$'\n'
banner+="│ records will fail \`npm run memory:check\` until updated."$'\n'
banner+="└─────────────────────────────────────────────────────────────────┘"$'\n'

BANNER_TEXT="$banner" node -e 'console.log(JSON.stringify({ continue: true, additionalContext: process.env.BANNER_TEXT }))'
