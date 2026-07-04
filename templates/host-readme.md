# memory/

Structured, drift-checked memory for AI agents (and humans). Each file under
`records/` is one **decision**, **convention**, **fact**, **feature**, or
**deferred** item, with machine-verifiable assertions that fail
`npm run memory:check` when the code and the record diverge.

- **Agents**: `INDEX.md` is the digest (one line per record); open a record for
  the rationale before changing anything it anchors. Cite record IDs.
- **Capture**: `/memorybank:new` when a decision is made. **Verify**: `npm run memory:check`
  (runs in CI). **Audit**: `/memorybank:review`. **Re-stamp**: `npm run memory:sync`.
- `INDEX.md` is **generated** — never hand-edit; regenerate with `npm run memory:index`.
- Record prose style: if `STYLE.md` exists here, follow it (caveman-terse — records
  load into every session, tokens cost).
- Never delete a record that turned out wrong — mark it `status: superseded`
  with a `superseded-by:` pointer, so the history of *why* survives.

Record format and assertion language: see the memory-bank plugin README.
