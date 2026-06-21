---
description: Capture a design decision, convention, fact, feature, or deferred item as a memory record
argument-hint: "[kind] [title]"
---

Capture a new memory record for: $ARGUMENTS

1. **Determine the kind** (from the arguments or by asking): `decision` (a locked choice with rationale), `convention` (a rule agents must follow), `fact` (a volatile value that drifts when hardcoded in prose), `feature` (behaviour + invariants of a shipped feature), `deferred` (intentionally NOT done — protects gaps from being "fixed").
2. **Scaffold it**: run the checker's `new` subcommand — `npm run memory:check` minus the verb, i.e. `tsx <checker path> new <kind> --title "<title>"` (checker path: `memory/memory.ts` if vendored, else the in-tree plugin `scripts/memory.ts`).
3. **Fill in the record** (this is the valuable part — do not leave template placeholders):
   - `rule:` ONE line an agent can act on without opening the file.
   - `anchors:` the files this record governs — these drive edit-time nudges.
   - `assertions:` make it machine-verifiable wherever possible:
     - `count` for anything numeric that appears in prose
     - `symbol-exists` to pin an anchor that must keep existing
     - `forbidden` for anti-patterns (glob + regex, with an `allow:` list for sanctioned exceptions)
     - `command` to delegate to an existing repo check
     - `none` ONLY for genuinely unverifiable process rules (give the reason)
   - Body `## Why`: the rationale — what breaks without this, what alternatives were rejected. Write it for the future agent who is about to "fix" this.
4. **Regenerate + verify**: run `memory:index` then `memory:check`. Both must be green.
5. If this record makes any hand-written prose redundant (a hardcoded count, a duplicated rule), update that prose to reference the record ID instead.
