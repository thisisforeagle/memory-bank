---
id: {{ID}}
title: {{TITLE}}
kind: feature
status: active
rule: "ONE-LINE description of what the feature does and where its surface lives."
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

Behaviour summary: inputs, outputs, who can use it (roles), and the happy path.

## Edge cases & invariants

The non-obvious behaviours an agent must preserve when touching this feature.
