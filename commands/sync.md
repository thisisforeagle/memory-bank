---
description: Regenerate the memory index and re-stamp verified dates after a green check
---

Run `npm run memory:sync` (fallback: the checker with `sync`).

This regenerates `memory/INDEX.md`, runs the full assertion suite, and — only if everything passes — stamps `verified: { date, sha }` on every active record.

- If it **fails**: do NOT force it. Reconcile the failures first (see /memorybank:check semantics: bump record values for legitimate code changes, fix code for violations), then re-run sync.
- If it **succeeds**: stage the touched files (`memory/INDEX.md` + all re-stamped records) so the stamps land with the current change. Mention the new stamp date/sha in your report.

Use this after: adding/updating records, fixing drift failures, or at the end of a `/memorybank:review`.
