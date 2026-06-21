---
description: Run the memory-bank drift checker and explain any failures
---

Run `npm run memory:check` (fallback: `tsx memory/memory.ts check` or the in-tree plugin checker with `check`).

- If **green**: report the summary line (records, assertions, unverifiable count) and stop.
- If **red**: for each failure, diagnose which side drifted:
  - **The code changed legitimately** (e.g. a new ActivityType member, a new permission key): update the record — bump `count.equals`, adjust the anchor/pattern — and update any prose that the record's `## How to update` section points at. Then re-run.
  - **The code change violates the recorded rule** (e.g. a `forbidden` pattern hit): fix the code, citing the record ID and its `## Why` in your explanation.
  - **The record itself is wrong/obsolete**: do NOT silently delete it — set `status: superseded` with a `superseded-by:` pointer (or `retired`), and explain why in the record body. Surface this to the user, since retiring a record is a decision.
- If `INDEX.md is stale`: run `memory:index` and include the regenerated file in the change.
- Finish by re-running `memory:check` until green, and report what was reconciled.
