---
id: {{ID}}
title: {{TITLE}}
kind: decision
status: active
rule: "ONE-LINE statement of what was decided (the locked outcome, not the discussion)."
anchors:
  - path: path/to/file/that/embodies/the/decision.ts
assertions:
  - type: symbol-exists
    path: path/to/file/that/embodies/the/decision.ts
    pattern: 'anchor regex proving the decision still holds'
links: []
owners: []
created: {{DATE}}
---

## Why

What problem this decision solved, what alternatives were rejected and why.
This is the section that stops a future agent from re-litigating the choice.

## Consequences

What this decision makes easy / hard. What would have to be true to revisit it.
