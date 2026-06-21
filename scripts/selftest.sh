#!/usr/bin/env bash
# selftest.sh — sanity-check the memory-bank checker against its fixtures.
# fixtures/pass must be green; fixtures/fail must exit non-zero.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== fixtures/pass (expect PASS) =="
npx tsx scripts/memory.ts check --root fixtures/pass

echo ""
echo "== fixtures/fail (expect FAIL) =="
if npx tsx scripts/memory.ts check --root fixtures/fail; then
  echo "selftest FAILED: fail fixture unexpectedly passed" >&2
  exit 1
fi

echo ""
echo "selftest OK"
