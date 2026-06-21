---
description: Adopt memory-bank in this repository — scaffold memory/, vendor the checker, wire CI
---

Set up the memory-bank system in the current repository. Steps:

1. **Check for an existing bank**: if `memory/records/` already exists, stop and report — this repo is already initialized (suggest `/memory-bank:check` instead).
2. **Scaffold the directory layout**:
   - `memory/records/{conventions,decisions,facts,features,deferred}/` (create with `.gitkeep` files so empty dirs survive git)
   - `memory/README.md` from the plugin's `templates/host-readme.md` (resolve the plugin root from this command's own location)
3. **Vendor the checker** so CI never depends on plugin installation: copy `scripts/memory.ts` from the plugin into `memory/memory.ts`, adding a header comment `// vendored from memory-bank plugin vX.Y.Z — update by re-running /memory-bank:init` (read the version from the plugin's `.claude-plugin/plugin.json`). EXCEPTION: if the plugin source lives inside this same repository (e.g. a `plugins/memory-bank/` directory exists in the repo), skip vendoring and point scripts at the in-tree source instead.
4. **Add package.json scripts** (or the closest equivalent for the repo's toolchain — Makefile target, justfile recipe):
   - `memory:check` → `tsx <checker path> check`
   - `memory:index` → `tsx <checker path> index`
   - `memory:stale` → `tsx <checker path> stale`
   - `memory:sync` → `tsx <checker path> sync`
   - Ensure `tsx` is available (devDependency or `npx tsx`).
5. **Generate the initial index**: run `memory:index`, then add `@memory/INDEX.md` to the repo's CLAUDE.md import block (create a minimal CLAUDE.md if absent).
6. **Wire CI**: find the repo's CI workflow (`.github/workflows/*.yml` or equivalent) and add a `memory:check` step to the PR/push pipeline. If no CI exists, report that and suggest one.
7. **Report**: list created files, and suggest capturing the first records with `/memory-bank:new` — good starter candidates are: locked architecture decisions, "intentionally not done" items, and any volatile counts currently hardcoded in docs.

Respect the host repo's conventions throughout (read its CLAUDE.md / contributing docs first).
