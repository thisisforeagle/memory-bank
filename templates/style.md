# Record style: caveman compression

Records + INDEX.md load into agent sessions. Every token costs. Write terse,
telegraphic, unambiguous. Brevity never beats clarity — if terse version can
be misread, add words back.

## Rules

1. Drop articles + filler. No "the/a/an" where meaning survives. Banned:
   "in order to", "it is important", "note that", "please", "you should".
2. Imperative fragments, verb first: "Use X", "Never Y", "Prefer A over B".
   No hedging ("consider", "probably", "maybe") — hedged rule is not a rule.
3. One idea per fragment. Join with "—" or ";". No connective prose.
4. NEVER compress load-bearing tokens: paths, symbols, regexes, commands,
   versions, record IDs — exact, always.
5. Abbreviations OK when unambiguous: config, deps, env, CI, e2e, auth.
   Never invent project-specific abbreviations.
6. No emoji. Never restate an assertion in prose — assertion already says it.

## Budgets (targets, not gates)

- `rule:` line — <=90 chars (~15 tokens). Must stand alone: agent acts on it
  without opening record.
- `## Why` body — <=3 lines (~40 tokens). What breaks, not history.
- Other body sections — <=4 lines each.
- INDEX row = rule line verbatim. Long rule = long index forever. Trim at source.

## Example

Verbose: "We decided that developers should always use the `fetchUser` helper
in `src/api/user.ts` instead of calling fetch directly, because direct calls
bypass the retry and auth-refresh logic."

Caveman: "Use fetchUser (src/api/user.ts) — never raw fetch for user API;
raw fetch skips retry + auth refresh."
