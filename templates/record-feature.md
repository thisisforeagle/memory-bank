---
id: {{ID}}
title: {{TITLE}}
kind: feature
status: active
rule: "ONE line, caveman-terse: what feature does + where its surface lives."
anchors:
  - path: path/to/feature/entrypoint.tsx
assertions:
  - type: symbol-exists
    path: path/to/feature/entrypoint.tsx
    pattern: 'anchor regex proving the feature surface still exists'
links: []
owners: []
created: {{DATE}}
---

## What it does

Inputs, outputs, roles, happy path. <=4 lines.

## Edge cases & invariants

Non-obvious behaviours agent must preserve when touching this feature.
