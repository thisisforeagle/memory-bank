#!/usr/bin/env bash
# file-size-guard.sh — memory-bank plugin PostToolUse hook (Edit|Write|MultiEdit)
# and standalone CI check.
#
# Caps source files at MEMORYBANK_MAX_FILE_LINES lines (default 800). Two modes:
#
#   hook mode (default, PostToolUse JSON on stdin):
#     the just-edited file over the cap → exit 2 with guidance on stderr so the
#     agent splits the file (or exempts it) before moving on. Silent otherwise.
#
#   CI mode (--all [--root <dir>]):
#     scan every tracked text file; print `FAIL <path>: <n> lines (limit N)`
#     per violation and exit 1 if there are any. Wire it into the same CI job
#     as `memory:check`.
#
# Exemptions (matched case-insensitively against the repo-relative path;
# patterns without a slash match the basename):
#   - built-ins below: the vendored single-file checker, lockfiles, minified/
#     bundled/vendored output, generated code, data and rules files
#   - `.file-size-ignore` at the repo root: one glob per line, `#` comments
#
# Like the other hooks: pure bash, and infrastructure problems (missing jq,
# unreadable file, no git) never block — only a real violation does.

set -u

LIMIT="${MEMORYBANK_MAX_FILE_LINES:-800}"

BUILTIN_EXEMPT="
scripts/memory.ts
memory/memory.ts
memory/file-size-guard.sh
package-lock.json
yarn.lock
pnpm-lock.yaml
*.lock
*.min.*
dist/**
build/**
vendor/**
node_modules/**
*.generated.*
*.pb.go
*_pb2.py
*.map
*.snap
*.rules
*.svg
*.csv
*.tsv
*.ndjson
.file-size-ignore
"

shopt -s nocasematch 2>/dev/null || true

# match_one <rel-path> <pattern> — bash-glob match; `dir/**` is a prefix match,
# a pattern without `/` matches the basename.
match_one() {
  local rel="$1" pat="$2" target="$1"
  case "$pat" in
    *'/**')
      case "$rel" in ${pat%'/**'}/*) return 0 ;; esac
      return 1
      ;;
    */*) ;;
    *) target="${rel##*/}" ;;
  esac
  # shellcheck disable=SC2254
  case "$target" in $pat) return 0 ;; esac
  return 1
}

# is_exempt <rel-path> <root> — built-ins plus the repo's .file-size-ignore.
is_exempt() {
  local rel="$1" root="$2" pat
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    match_one "$rel" "$pat" && return 0
  done <<<"$BUILTIN_EXEMPT"
  if [ -f "$root/.file-size-ignore" ]; then
    while IFS= read -r pat; do
      pat="${pat%%#*}"
      pat="${pat#"${pat%%[![:space:]]*}"}"
      pat="${pat%"${pat##*[![:space:]]}"}"
      [ -z "$pat" ] && continue
      match_one "$rel" "$pat" && return 0
    done <"$root/.file-size-ignore"
  fi
  return 1
}

# is_text <file> — grep -I treats binary as non-matching.
is_text() {
  grep -Iq '' "$1" 2>/dev/null
}

# ---------------------------------------------------------------------------
# CI mode
# ---------------------------------------------------------------------------

if [ "${1:-}" = "--all" ]; then
  ROOT="${3:-}"
  [ "${2:-}" = "--root" ] && [ -n "$ROOT" ] || ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
  cd "$ROOT" || exit 0

  FAILED=0
  CHECKED=0
  while IFS= read -r -d '' f; do
    [ -f "$f" ] || continue
    is_exempt "$f" "$ROOT" && continue
    is_text "$f" || continue
    CHECKED=$((CHECKED + 1))
    n=$(wc -l <"$f")
    if [ "$n" -gt "$LIMIT" ]; then
      echo "FAIL $f: $n lines (limit $LIMIT)"
      FAILED=$((FAILED + 1))
    fi
  done < <(git ls-files -z 2>/dev/null)

  if [ "$FAILED" -gt 0 ]; then
    echo ""
    echo "$FAILED file(s) over the $LIMIT-line cap. Split them, or exempt legitimately large files via .file-size-ignore (one glob per line)."
    exit 1
  fi
  echo "file-size guard: $CHECKED file(s) checked, none over $LIMIT lines"
  exit 0
fi

# ---------------------------------------------------------------------------
# Hook mode
# ---------------------------------------------------------------------------

INPUT=$(cat 2>/dev/null || true)

command -v jq >/dev/null 2>&1 || exit 0

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null)
[ -z "$FILE_PATH" ] && exit 0
[ -f "$FILE_PATH" ] || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
REL="$FILE_PATH"
case "$FILE_PATH" in "$ROOT"/*) REL="${FILE_PATH#"$ROOT"/}" ;; esac

is_exempt "$REL" "$ROOT" && exit 0
is_text "$FILE_PATH" || exit 0

N=$(wc -l <"$FILE_PATH" 2>/dev/null) || exit 0
[ "$N" -gt "$LIMIT" ] || exit 0

cat >&2 <<EOF
file-size guard: $REL is $N lines — over the $LIMIT-line cap.
Split it into smaller modules before continuing. If this file is legitimately
large (generated, vendored, data), add a glob for it to .file-size-ignore at
the repo root instead.
EOF
exit 2
