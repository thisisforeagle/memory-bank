#!/usr/bin/env bash
# selftest.sh — sanity-check the memory-bank checker against its fixtures.
#
#   1. fixtures/pass must be green; fixtures/fail must exit non-zero.
#   2. `memory stale` must be three-state: stale / unknown (shallow clone) / fresh.
#   3. `memory sync` must refuse to stamp without an explicit --all or --only,
#      and --only must stamp exactly one record (validated before any write).
#
# Tests 2+ build throwaway git repos from fixtures/pass under a mktemp scratch
# root; fixtures/ itself is never modified.
set -euo pipefail
cd "$(dirname "$0")/.."
PLUGIN_DIR=$(pwd)

TMP=$(mktemp -d "${TMPDIR:-/tmp}/memory-bank-selftest.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Loud failure: message on stderr, exit 1.
fail() {
  echo "selftest FAILED: $*" >&2
  exit 1
}

dump() {
  echo "--- captured output ---" >&2
  printf '%s\n' "$1" >&2
  echo "-----------------------" >&2
}

# assert_contains <haystack> <needle> <label>
assert_contains() {
  case "$1" in
    *"$2"*) return 0 ;;
  esac
  dump "$1"
  fail "$3: expected output to contain: $2"
}

# assert_not_contains <haystack> <needle> <label>
assert_not_contains() {
  case "$1" in
    *"$2"*)
      dump "$1"
      fail "$3: expected output NOT to contain: $2"
      ;;
  esac
  return 0
}

# assert_eq <actual> <expected> <label>
assert_eq() {
  [ "$1" = "$2" ] || fail "$3: expected '$2', got '$1'"
}

# assert_rc_zero / assert_rc_nonzero <rc> <label>
assert_rc_zero() {
  [ "$1" -eq 0 ] || fail "$2: expected exit code 0, got $1"
}
assert_rc_nonzero() {
  [ "$1" -ne 0 ] || fail "$2: expected a non-zero exit code, got 0"
}

# run_memory <args...> — runs the checker, sets globals STDOUT (stdout alone,
# for JSON parsing — npm/npx warnings on stderr must never leak into it),
# OUT (stdout + stderr, for human-readable assertions) and RC.
run_memory() {
  RC=0
  local err="$TMP/run-memory.stderr"
  STDOUT=$(npx tsx "$PLUGIN_DIR/scripts/memory.ts" "$@" 2>"$err") || RC=$?
  OUT=$(printf '%s\n%s' "$STDOUT" "$(cat "$err")")
}

# make_repo <dir> — a real git repo seeded with fixtures/pass, everything committed.
# (sync runs the full check, and CONV-001's `forbidden` assertion shells out to
# `git ls-files`, so the scratch bank must be a genuine repo with tracked files.)
make_repo() {
  local dest="$1"
  mkdir -p "$dest"
  cp -R "$PLUGIN_DIR/fixtures/pass/." "$dest/"
  git init -q "$dest"
  git -C "$dest" config user.email test@example.com
  git -C "$dest" config user.name test
  git -C "$dest" config commit.gpgsign false
  git -C "$dest" add -A
  git -C "$dest" commit -q -m "seed memory bank from fixtures/pass"
}

# stamp_verified <record-file> <date> <sha> — insert a verified: block into the
# frontmatter, immediately before its closing '---'.
stamp_verified() {
  local file="$1" date="$2" sha="$3"
  awk -v d="$date" -v s="$sha" '
    NR > 1 && !done && $0 == "---" {
      print "verified:"
      print "  date: " d
      print "  sha: " s
      done = 1
    }
    { print }
  ' "$file" >"$file.stamped"
  mv "$file.stamped" "$file"
  grep -q "^verified:$" "$file" || fail "stamp_verified: no verified: key landed in $file"
  grep -q "^  sha: $sha$" "$file" || fail "stamp_verified: sha not inserted into $file"
}

# bank_sums <repo> — md5 of every file under memory/, sorted and stable.
bank_sums() {
  (cd "$1" && find memory -type f | LC_ALL=C sort | xargs md5sum)
}

FACT_REL="memory/records/facts/FACT-001-color-count.md"

# ---------------------------------------------------------------------------
# 1. fixtures (unchanged behaviour)
# ---------------------------------------------------------------------------

echo "== fixtures/pass (expect PASS) =="
npx tsx scripts/memory.ts check --root fixtures/pass

echo ""
echo "== fixtures/fail (expect FAIL) =="
if npx tsx scripts/memory.ts check --root fixtures/fail; then
  fail "fail fixture unexpectedly passed"
fi

# ---------------------------------------------------------------------------
# 2. stale: shallow clone → unknown, not stale
# ---------------------------------------------------------------------------

echo ""
echo "== stale: shallow clone → unknown, not stale =="

SRC="$TMP/shallow-src"
make_repo "$SRC"
FIRST=$(git -C "$SRC" rev-parse HEAD)
# Second commit so --depth 1 has something to truncate. Use a throwaway file:
# src/sample.ts is under a `count` assertion and must not be touched.
printf 'scratch commit so the clone is genuinely shallow\n' >"$SRC/notes.txt"
git -C "$SRC" add -A
git -C "$SRC" commit -q -m "second commit"

SHALLOW="$TMP/shallow-clone"
# file:// is required — a plain path clone hardlinks the full object store and
# silently ignores --depth.
git clone -q --depth 1 "file://$SRC" "$SHALLOW"
IS_SHALLOW=$(git -C "$SHALLOW" rev-parse --is-shallow-repository)
if [ "$IS_SHALLOW" != "true" ]; then
  fail "could not produce a shallow clone (is-shallow-repository=$IS_SHALLOW) — this git cannot exercise the shallow path"
fi

# FACT-001 points at a sha that was truncated out of the shallow clone.
stamp_verified "$SHALLOW/$FACT_REL" 2026-01-01 "$FIRST"

run_memory stale --root "$SHALLOW"
assert_rc_zero "$RC" "stale (shallow)"
assert_contains "$OUT" "1 unknown (shallow clone)" "stale (shallow)"
assert_contains "$OUT" "note: shallow clone" "stale (shallow)"
assert_contains "$OUT" "git fetch --unshallow" "stale (shallow)"
# The unknown record must NOT be reported per-record as stale...
assert_not_contains "$OUT" "FACT-001 — verified sha" "stale (shallow)"
# ...and must be excluded from the stale count: only the two never-verified
# records (CONV-001, DEF-001) are stale.
assert_contains "$OUT" "2 stale" "stale (shallow)"
assert_contains "$OUT" "3 active records" "stale (shallow)"

run_memory stale --json --root "$SHALLOW"
assert_rc_zero "$RC" "stale --json (shallow)"
printf '%s\n' "$STDOUT" >"$TMP/stale-shallow.json"
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const bad = [];
if (j.shallow !== true) bad.push(`shallow is ${JSON.stringify(j.shallow)}, want true`);
if (j.unknownCount !== 1) bad.push(`unknownCount is ${JSON.stringify(j.unknownCount)}, want 1`);
if (j.staleCount !== 2) bad.push(`staleCount is ${JSON.stringify(j.staleCount)}, want 2`);
if (j.active !== 3) bad.push(`active is ${JSON.stringify(j.active)}, want 3`);
if (!Array.isArray(j.unknown) || !j.unknown.some((u) => u && u.id === "FACT-001")) {
  bad.push("FACT-001 missing from unknown[]");
}
if (Array.isArray(j.stale) && j.stale.some((s) => s && s.id === "FACT-001")) {
  bad.push("FACT-001 wrongly listed in stale[]");
}
if (bad.length) { console.error(bad.join("; ")); process.exit(1); }
' "$TMP/stale-shallow.json" || { dump "$OUT"; fail "stale --json (shallow): assertions above failed"; }

# A malformed (non-hex) sha is a broken stamp, not a shallow-clone artefact —
# it must stay loud even here. CONV-001 flips from never-verified to
# invalid-sha stale, so the counts stay at 2 stale / 1 unknown.
stamp_verified "$SHALLOW/memory/records/conventions/CONV-001-no-legacy-token.md" 2026-01-01 "not-a-real-sha"
run_memory stale --root "$SHALLOW"
assert_rc_zero "$RC" "stale (shallow, malformed sha)"
assert_contains "$OUT" "STALE CONV-001" "stale (shallow, malformed sha)"
assert_contains "$OUT" "not a valid commit id" "stale (shallow, malformed sha)"
assert_contains "$OUT" "2 stale" "stale (shallow, malformed sha)"
assert_contains "$OUT" "1 unknown (shallow clone)" "stale (shallow, malformed sha)"

# ---------------------------------------------------------------------------
# 3. stale: complete clone + fabricated sha stays loud
# ---------------------------------------------------------------------------

echo ""
echo "== stale: complete clone + fabricated sha stays loud =="

COMPLETE="$TMP/complete"
make_repo "$COMPLETE"
# Hex letters matter: an all-digit sha is parsed as a YAML number and mangled,
# tripping the invalid-commit-id guard instead of the not-in-history path.
stamp_verified "$COMPLETE/$FACT_REL" 2026-01-01 0123456789abcdef0123456789abcdef01234567

run_memory stale --root "$COMPLETE"
assert_rc_zero "$RC" "stale (complete)"
assert_contains "$OUT" "STALE FACT-001" "stale (complete)"
assert_contains "$OUT" "not found in history" "stale (complete)"
assert_not_contains "$OUT" "unknown (shallow clone)" "stale (complete)"

# ---------------------------------------------------------------------------
# 4. sync: bare refuses, --all stamps
# ---------------------------------------------------------------------------

echo ""
echo "== sync: bare refuses, --all stamps =="

SYNC_ALL="$TMP/sync-all"
make_repo "$SYNC_ALL"

BEFORE=$(bank_sums "$SYNC_ALL")
run_memory sync --root "$SYNC_ALL"
assert_rc_nonzero "$RC" "bare sync"
assert_eq "$RC" "2" "bare sync exit code"
assert_contains "$OUT" "--all" "bare sync"
assert_contains "$OUT" "--only" "bare sync"
AFTER=$(bank_sums "$SYNC_ALL")
if [ "$BEFORE" != "$AFTER" ]; then
  dump "$OUT"
  fail "bare sync: refused but still wrote to memory/"
fi

run_memory sync --all --root "$SYNC_ALL"
assert_rc_zero "$RC" "sync --all"
assert_contains "$OUT" "stamped verified:" "sync --all"
assert_contains "$OUT" "on 3 of 3 active record(s)" "sync --all"
for rec in \
  "memory/records/conventions/CONV-001-no-legacy-token.md" \
  "memory/records/deferred/DEF-001-no-dark-mode.md" \
  "$FACT_REL"; do
  grep -q "^verified:$" "$SYNC_ALL/$rec" || fail "sync --all: no verified: stamp in $rec"
done

# ---------------------------------------------------------------------------
# 5. sync --only stamps exactly one
# ---------------------------------------------------------------------------

echo ""
echo "== sync --only stamps exactly one =="

SYNC_ONLY="$TMP/sync-only"
make_repo "$SYNC_ONLY"

# Compare checksums, not mtimes: sync regenerates INDEX.md, but for an
# unchanged bank the regenerated bytes are identical.
BEFORE=$(bank_sums "$SYNC_ONLY")
run_memory sync --only FACT-001 --root "$SYNC_ONLY"
assert_rc_zero "$RC" "sync --only FACT-001"
assert_contains "$OUT" "(--only FACT-001)" "sync --only FACT-001"
assert_contains "$OUT" "1 of 3" "sync --only FACT-001"
grep -q "^verified:$" "$SYNC_ONLY/$FACT_REL" || fail "sync --only FACT-001: target record was not stamped"

AFTER=$(bank_sums "$SYNC_ONLY")
BEFORE_OTHERS=$(printf '%s\n' "$BEFORE" | grep -v "FACT-001" || true)
AFTER_OTHERS=$(printf '%s\n' "$AFTER" | grep -v "FACT-001" || true)
if [ "$BEFORE_OTHERS" != "$AFTER_OTHERS" ]; then
  echo "--- before ---" >&2; printf '%s\n' "$BEFORE_OTHERS" >&2
  echo "--- after ----" >&2; printf '%s\n' "$AFTER_OTHERS" >&2
  fail "sync --only FACT-001: files other than the target changed"
fi
if [ "$BEFORE" = "$AFTER" ]; then
  fail "sync --only FACT-001: nothing changed at all — the target was not stamped"
fi

# ---------------------------------------------------------------------------
# 6. sync --only unknown id writes nothing
# ---------------------------------------------------------------------------

echo ""
echo "== sync --only unknown id writes nothing =="

SYNC_BOGUS="$TMP/sync-bogus"
make_repo "$SYNC_BOGUS"

BEFORE=$(bank_sums "$SYNC_BOGUS")
run_memory sync --only BOGUS-999 --root "$SYNC_BOGUS"
assert_rc_nonzero "$RC" "sync --only BOGUS-999"
AFTER=$(bank_sums "$SYNC_BOGUS")
if [ "$BEFORE" != "$AFTER" ]; then
  echo "--- before ---" >&2; printf '%s\n' "$BEFORE" >&2
  echo "--- after ----" >&2; printf '%s\n' "$AFTER" >&2
  fail "sync --only BOGUS-999: rejected an unknown id but still wrote to memory/ (INDEX.md included)"
fi

# ---------------------------------------------------------------------------
# 7. sync --only together with --all is rejected
# ---------------------------------------------------------------------------

echo ""
echo "== sync --only with --all is rejected =="

SYNC_BOTH="$TMP/sync-both"
make_repo "$SYNC_BOTH"

BEFORE=$(bank_sums "$SYNC_BOTH")
run_memory sync --all --only FACT-001 --root "$SYNC_BOTH"
assert_rc_nonzero "$RC" "sync --all --only"
assert_eq "$RC" "2" "sync --all --only exit code"
AFTER=$(bank_sums "$SYNC_BOTH")
if [ "$BEFORE" != "$AFTER" ]; then
  fail "sync --all --only: rejected the combination but still wrote to memory/"
fi

# run_guard <args-or-stdin...> — file-size-guard.sh wrapper, same OUT/RC contract.
run_guard() {
  RC=0
  OUT=$(bash "$PLUGIN_DIR/hooks/file-size-guard.sh" "$@" 2>&1) || RC=$?
}

# ---------------------------------------------------------------------------
# 8. sync --only without an id is a usage error, never a blanket stamp
# ---------------------------------------------------------------------------

echo ""
echo "== sync --only without an id is a usage error =="

# --only consumes the next argument as its value, so it must come last here.
BEFORE=$(bank_sums "$SYNC_BOTH")
run_memory sync --root "$SYNC_BOTH" --only
assert_rc_nonzero "$RC" "sync --only (no id)"
assert_eq "$RC" "2" "sync --only (no id) exit code"
assert_contains "$OUT" "requires a record id" "sync --only (no id)"

# The dangerous variant: with --all also present, a silently-dropped empty
# --only would blanket-stamp — exactly the bug class this PR fixes.
run_memory sync --all --root "$SYNC_BOTH" --only
assert_rc_nonzero "$RC" "sync --all --only (no id)"
assert_eq "$RC" "2" "sync --all --only (no id) exit code"
assert_not_contains "$OUT" "stamped verified:" "sync --all --only (no id)"
AFTER=$(bank_sums "$SYNC_BOTH")
if [ "$BEFORE" != "$AFTER" ]; then
  fail "sync --only without an id: rejected but still wrote to memory/"
fi

# ---------------------------------------------------------------------------
# 9. file-size guard: 800-line cap, exemptions, hook mode
# ---------------------------------------------------------------------------

echo ""
echo "== file-size guard: cap, exemptions, hook mode =="

GUARD_REPO="$TMP/guard"
mkdir -p "$GUARD_REPO"
git init -q "$GUARD_REPO"
git -C "$GUARD_REPO" config user.email test@example.com
git -C "$GUARD_REPO" config user.name test
git -C "$GUARD_REPO" config commit.gpgsign false
seq 1 801 >"$GUARD_REPO/big.ts"
seq 1 801 >"$GUARD_REPO/yarn.lock"
seq 1 10 >"$GUARD_REPO/small.ts"
git -C "$GUARD_REPO" add -A
git -C "$GUARD_REPO" commit -q -m "guard fixtures"

# Tracked 801-line file fails --all; the lockfile is built-in exempt.
run_guard --all --root "$GUARD_REPO"
assert_rc_nonzero "$RC" "guard --all (violation)"
assert_contains "$OUT" "FAIL big.ts: 801 lines" "guard --all (violation)"
assert_not_contains "$OUT" "yarn.lock" "guard --all (lockfile exempt)"

# .file-size-ignore exempts it.
echo "big.ts" >"$GUARD_REPO/.file-size-ignore"
git -C "$GUARD_REPO" add -A
git -C "$GUARD_REPO" commit -q -m "exempt big.ts"
run_guard --all --root "$GUARD_REPO"
assert_rc_zero "$RC" "guard --all (.file-size-ignore)"
assert_contains "$OUT" "none over 800 lines" "guard --all (.file-size-ignore)"

# Hook mode: over-cap non-exempt file blocks with exit 2 and guidance...
rm "$GUARD_REPO/.file-size-ignore"
RC=0
OUT=$(printf '{"tool_input":{"file_path":"%s"}}' "$GUARD_REPO/big.ts" \
  | CLAUDE_PROJECT_DIR="$GUARD_REPO" bash "$PLUGIN_DIR/hooks/file-size-guard.sh" 2>&1) || RC=$?
assert_eq "$RC" "2" "guard hook (violation) exit code"
assert_contains "$OUT" "over the 800-line cap" "guard hook (violation)"
assert_contains "$OUT" ".file-size-ignore" "guard hook (violation guidance)"

# ...an exempt file and a small file stay silent.
for f in yarn.lock small.ts; do
  RC=0
  OUT=$(printf '{"tool_input":{"file_path":"%s"}}' "$GUARD_REPO/$f" \
    | CLAUDE_PROJECT_DIR="$GUARD_REPO" bash "$PLUGIN_DIR/hooks/file-size-guard.sh" 2>&1) || RC=$?
  assert_rc_zero "$RC" "guard hook ($f)"
  assert_eq "$OUT" "" "guard hook ($f) output"
done

echo ""
echo "selftest OK"
