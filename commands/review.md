---
description: Audit the memory bank — drift check + staleness review, propose record updates
---

Full memory-bank audit. This goes beyond `/memory-bank:check` (hard failures) to catch *semantic* drift — records whose assertions still pass but whose anchored code changed since last verification.

1. Run `npm run memory:check`. Reconcile any hard failures first (see /memory-bank:check semantics).
2. Run `npm run memory:stale`. For each STALE record:
   - Read the record (rule, Why, assertions) and `git diff <verified-sha> -- <anchor paths>` to see what actually changed in its anchors.
   - Judge: does the change alter the recorded behaviour/decision? If yes, propose a record update (and any prose updates). If no, the record just needs re-stamping.
3. Look for **unrecorded decisions**: scan recent commits (`git log --oneline -20`) and the working diff for changes that look like new conventions, locked choices, or intentional gaps with no corresponding record. Propose `/memory-bank:new` candidates — title + kind + suggested assertion each.
4. Present findings as a short report: hard failures fixed, stale records (update vs re-stamp), proposed new records. Apply the uncontroversial updates; ask before retiring or rewriting any record's rule.
5. Finish with `npm run memory:sync` (only if everything is green) so all records get a fresh `verified:` stamp, then report.
