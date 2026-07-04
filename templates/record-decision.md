---
id: {{ID}}
title: {{TITLE}}
kind: decision
status: active
rule: "ONE line, caveman-terse: the locked outcome, not the discussion (see memory/STYLE.md)."
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

Problem solved; alternatives rejected + why. <=3 lines. Stops future agent
re-litigating the choice.

## Consequences

What this makes easy / hard. What must change to revisit.
