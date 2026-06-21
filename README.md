# memory-bank — drift-checked memory records for AI agents

A Claude Code plugin that gives any repository a **structured memory system**:
design decisions, conventions, volatile facts, feature invariants, and
intentionally-deferred work captured as one-file-per-record markdown with rigid
YAML frontmatter — each carrying **machine-verifiable assertions** that fail CI
when memory and code diverge.

## Why

Markdown memory files (CLAUDE.md and friends) drift: counts go stale, recipes
reference removed APIs, deliberate gaps get "fixed" by well-meaning agents.
memory-bank makes every memory claim either *asserted* (CI-checked against the
code) or *explicitly marked unverifiable* — and keeps the rationale (the WHY)
one `Read` away from the code it governs.

## The model

```
memory/
├── INDEX.md                  # GENERATED digest — @-import it from CLAUDE.md
├── README.md
└── records/
    ├── conventions/CONV-001-….md     # rules agents must follow
    ├── decisions/DEC-001-….md        # locked choices + rejected alternatives
    ├── facts/FACT-001-….md           # volatile values (counts) — asserted, never hardcoded in prose
    ├── features/FEAT-001-….md        # shipped behaviour + invariants
    └── deferred/DEF-001-….md         # intentionally NOT done — don't "fix"
```

Each record: frontmatter (`id`, `kind`, `status`, one-line `rule`, `anchors`
to the files it governs, `assertions`, `verified` stamp) + body (`## Why` —
the rationale that stops future re-litigation).

### Assertion language (the whole spec)

| Type | Fields | Passes when |
|---|---|---|
| `file-exists` | `path` | the path exists |
| `symbol-exists` | `path`, `pattern` | regex matches in the file (anchor still present) |
| `count` | `path`, `pattern`, `equals` | regex match count equals N |
| `forbidden` | `glob`, `pattern`, `allow?` | zero matches across tracked+untracked files in the glob |
| `command` | `run`, `timeout?` | the shell command exits 0 (delegate to existing repo checks) |
| `none` | `reason` | always — explicitly unverifiable, kept honest in coverage stats |

Patterns are JS regexes (`m` flag; `count` adds `g`). Quote them in single
quotes in the frontmatter.

## The checker

`scripts/memory.ts` — single file, node builtins only, run with `tsx`:

```
memory check    [--json] [--skip-commands]   # verify everything; exit 1 on drift (the CI gate)
memory verify   <id>                         # one record
memory stale                                 # anchors changed since last verified sha (semantic-drift candidates)
memory index                                 # regenerate memory/INDEX.md (freshness is CI-gated)
memory anchors  --match <file>               # which records govern this file
memory new      <kind> --title "..."         # scaffold a record
memory sync     [--skip-commands]            # green check, then stamp verified: on all records
```

## What the plugin ships

- **Skills**: `/memory-bank:init` (adopt in a repo), `/memory-bank:new` (capture at the
  moment of decision), `/memory-bank:check`, `/memory-bank:review` (audit + reconcile),
  `/memory-bank:sync`.
- **Hooks** (never block, silent without `memory/`):
  - *SessionStart* — staleness digest (record count, stale records, last sync).
  - *PostToolUse* — when an edited file is anchored by records, nudge with their IDs + rules.
  - *Stop* — once per session: if anchored files changed but `memory/` didn't, remind the agent to capture or consciously skip.
- **Templates** for all five record kinds.

## Adopting in a repo

1. Install the plugin, run `/memory-bank:init` — scaffolds `memory/`, vendors the
   checker (`memory/memory.ts`) so CI never depends on plugin installation,
   adds `memory:*` package scripts, wires the CI step, and @-imports
   `memory/INDEX.md` from CLAUDE.md.
2. Capture your first records: locked architecture decisions, "intentionally
   not done" items, and every volatile count currently hardcoded in docs.
3. The maintenance loop is deliberate: a legitimate code change that breaks a
   `count` assertion **fails CI** — the failure message names the record;
   bump it in the same PR. That friction is the feature: memory and code can
   only move together.

## Maintenance loop (day-to-day)

- Made a decision? `/memory-bank:new` before the session ends (the Stop hook reminds you once).
- CI red on `memory:check`? The failure names the record and the fix direction — reconcile, never bypass.
- Weekly-ish: `/memory-bank:review` to catch semantic drift (`memory stale`), then `memory sync`.

## Self-test

```
plugins/memory-bank/scripts/selftest.sh
```

Runs the checker against `fixtures/pass` (must be green) and `fixtures/fail`
(must fail) — also useful as living documentation of the record format.
