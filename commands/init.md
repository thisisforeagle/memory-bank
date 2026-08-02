---
description: Adopt memory-bank in this repository — choose features, scaffold memory/, vendor the checker, seed stack best practices, wire CI
---

Set up the memory-bank system in the current repository. Steps:

1. **Check for an existing bank**: if `memory/records/` already exists, stop and report — this repo is already initialized (suggest `/memorybank:check` instead).
2. **Feature menu — let the user choose what to enable.** Ask via `AskUserQuestion` (multi-select) before touching anything:
   - **Stack best-practice seeding** (recommended): detect the tech stack, fetch current best practices, seed starter records (step 6).
   - **Testing setup** (recommended): testing conventions + guided test-framework setup, e.g. Playwright (step 6d).
   - **Caveman record style** (recommended): terse, token-minimal record prose per `STYLE.md` (vs normal prose).
   - **CI wiring** (recommended): add `memory:check` to the CI pipeline (step 8).

   Core scaffolding (memory/ dirs, vendored checker, package scripts, INDEX.md, CLAUDE.md import) is NOT optional — the system is useless without it. If running non-interactively, default all features ON — except actual test-framework *installation*, which always requires explicit confirmation (fall back to a `deferred` record) — and say in the final report which defaults were applied. A skipped feature must leave no half-done state.
3. **Scaffold the directory layout**:
   - `memory/records/{conventions,decisions,facts,features,deferred}/` (create with `.gitkeep` files so empty dirs survive git)
   - `memory/README.md` from the plugin's `templates/host-readme.md` (resolve the plugin root from this command's own location)
   - If caveman style was chosen: copy the plugin's `templates/style.md` to `memory/STYLE.md`. All record-writing steps below (and `/memorybank:new`, `/memorybank:review`) follow `memory/STYLE.md` when it exists; if the user declined, skip the copy and write records in normal prose.
4. **Vendor the checker** so CI never depends on plugin installation: copy `scripts/memory.ts` from the plugin into `memory/memory.ts`, adding a header comment `// vendored from memory-bank plugin vX.Y.Z — update by re-running /memorybank:init` on line 2, AFTER the `#!/usr/bin/env tsx` shebang (a comment before the shebang breaks the file) (read the version from the plugin's `.claude-plugin/plugin.json`). EXCEPTION: if the plugin source lives inside this same repository (e.g. a `plugins/memory-bank/` directory exists in the repo), skip vendoring and point scripts at the in-tree source instead.
5. **Add package.json scripts** (or the closest equivalent for the repo's toolchain — Makefile target, justfile recipe):
   - `memory:check` → `tsx <checker path> check`
   - `memory:index` → `tsx <checker path> index`
   - `memory:stale` → `tsx <checker path> stale`
   - `memory:sync` → `tsx <checker path> sync` (the scope guard lives in the checker; call sites pass the flag — invoke as `npm run memory:sync -- --all`, or `-- --only <id>` for a single record)
   - Ensure `tsx` is available (devDependency or `npx tsx`).
6. **Seed from stack** — distill current best practices for THIS repo's stack into starter records. Read `memory/STYLE.md` first (if present); every seeded record follows it. Skipping: if the user declined seeding but enabled testing, still run sub-steps a (stack detection), d, e, and f for the testing records only; if both were declined, skip this step entirely.
   - a. **Detect the stack.** Read manifests, do not guess:
     - `package.json` deps/devDeps → framework (next, react, vue, svelte, express, fastify, …), language (typescript), test tools (playwright, vitest, jest, cypress), styling/data (tailwind, prisma, drizzle, …)
     - `pyproject.toml` / `requirements.txt` → django, fastapi, flask, pytest
     - `go.mod`, `Cargo.toml`, `Gemfile`, `composer.json` → equivalents
     - Also note: existing lint/format config (rules already enforced there must NOT become records), existing test dirs, CI workflows.
     Summarize as 2–5 "stack pillars" (e.g. Next.js 15 + React 19 + TS + Tailwind, no test framework).
   - b. **Fetch current best practices LIVE** for each pillar — do not rely on training data alone:
     - Prefer Context7 MCP tools if available (resolve the library id, then query docs for "best practices", "common pitfalls", "recommended patterns", version-specific gotchas for the installed major version — check the lockfile for exact versions).
     - Else WebSearch/WebFetch official docs + release notes.
     - **Offline fallback**: if no fetch tool works, continue anyway — seed from repo inspection + model knowledge, add a line to each record's Why: "Seeded offline — verify against current docs." Report the degraded mode at the end. Never block init on network.
   - c. **Distill into 5–12 records (hard cap 15). Quality over quantity.** Every candidate must pass all three gates: specific to this repo (cites real paths in anchors, not generic advice); plausibly violated in practice (a rule nobody would break is noise); not already enforced by lint/typecheck/framework defaults. Required mix:
     - 1 meta convention against re-engineering — e.g. rule: "Check memory/INDEX.md before redesigning anything — decisions + deferred items are recorded; do not re-litigate or 'improve' unprompted." (assertion `none`, reason: process rule).
     - 2–5 bug-prevention conventions with `forbidden` assertions where the anti-pattern is regex-expressible (e.g. Next.js: no `<img>` in `:(glob)app/**/*.tsx` — use `next/image`), `symbol-exists` to pin a required pattern, `none` + reason only when truly unverifiable.
     - 1–3 feature-building pattern conventions (where new code of type X goes, which helper to use).
     - 1–3 `deferred` records for popular-but-not-adopted choices visible from the manifest (e.g. no state-management lib, no CSS-in-JS) so future agents don't "fix" the gap.
     - 1–2 testing conventions (see d, if testing was enabled).
   - d. **Testing help** (skip if the user declined testing; guidance, not aggressive scaffolding):
     - If a test framework fits the stack and is MISSING (e.g. web app, no e2e), ASK the user before touching anything: "No e2e framework detected — set up Playwright with config + one example spec?"
     - If yes: add the devDependency, a minimal config, ONE example spec exercising an existing critical path (homepage renders, health endpoint 200), and a package script. Stop there — no suite generation.
     - If no (or non-interactive/offline): seed a `deferred` record instead ("e2e testing deferred — revisit before first production release").
     - Either way seed 1–2 testing conventions appropriate to the stack, with `file-exists` on the config where applicable.
   - e. **Confirm before writing.** Present the proposed list to the user — one line each: kind, title, rule, assertion type. Let them prune/adjust. This is the record-spam guard; fewer good records beat many mediocre ones.
   - f. **Write the records** using the PLUGIN's checker so templates resolve: `npx tsx <plugin>/scripts/memory.ts new <kind> --title "..." --root <repo>` (the vendored copy resolves templates relative to itself and would miss them), then fill rule/anchors/assertions/Why per `/memorybank:new` semantics and `memory/STYLE.md`. Verify every `forbidden`/`count` assertion end-to-end before keeping it: `forbidden` globs are git pathspecs — write them as `:(glob)dir/**/*.ext` (a bare `dir/**/*.ext` silently misses top-level files, and a glob matching nothing makes the assertion pass vacuously). Confirm the glob hits intended files with `git ls-files -- '<glob>'`, then plant a temporary violation and confirm `memory:check` goes red before reverting it. A seeded record that fails on day one — or can never fail — is worse than no record.
7. **Generate the initial index**: run `memory:index`, then add `@memory/INDEX.md` to the repo's CLAUDE.md import block (create a minimal CLAUDE.md if absent).
8. **Wire CI** (skip if the user declined CI wiring — note it in the report): find the repo's CI workflow (`.github/workflows/*.yml` or equivalent) and add a `memory:check` step to the PR/push pipeline. If no CI exists, report that and suggest one.
9. **Report**: list created files; which features were enabled/skipped (and which defaults were applied if non-interactive); seeded record IDs; whether seeding ran offline-degraded; testing outcome (set up / declined / deferred). Suggest capturing project-specific records with `/memorybank:new` — good candidates are: locked architecture decisions, "intentionally not done" items, and any volatile counts currently hardcoded in docs.

Respect the host repo's conventions throughout (read its CLAUDE.md / contributing docs first).
