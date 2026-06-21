#!/usr/bin/env bash
# session-start-staleness.sh — memory-bank plugin SessionStart hook.
#
# Emits a short memory-bank status line: record count, stale records (anchors
# changed since their last verified sha). The full digest reaches the agent via
# the host repo's @memory/INDEX.md import — this hook only surfaces staleness.
# Silent in repos without a memory/ directory. Never blocks.

set -u

cat >/dev/null 2>&1 || true  # drain stdin

emit_continue() { printf '%s\n' '{"continue": true}'; exit 0; }
trap 'emit_continue' ERR

command -v node >/dev/null 2>&1 || emit_continue

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
[ -d "$ROOT/memory/records" ] || emit_continue

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

STALE_OUT=$(cd "$ROOT" && npx tsx "$PLUGIN_ROOT/scripts/memory.ts" stale 2>/dev/null | head -8) || STALE_OUT=""
if [ -z "$STALE_OUT" ]; then
  # tsx unavailable or checker failed — fall back to a bare count.
  N=$(find "$ROOT/memory/records" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
  STALE_OUT="$N memory records (staleness check unavailable — run npm run memory:stale)"
fi

CONTEXT="📚 memory-bank: ${STALE_OUT}
Records index: @memory/INDEX.md · verify: npm run memory:check · stale records may need /memory-bank:review"

CTX_TEXT="$CONTEXT" node -e 'console.log(JSON.stringify({ continue: true, additionalContext: process.env.CTX_TEXT }))'
