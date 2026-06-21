---
id: {{ID}}
title: {{TITLE}}
kind: fact
status: active
rule: "ONE-LINE statement of the volatile fact, citing where it lives — never hardcode this value in prose elsewhere."
anchors:
  - path: path/to/source/of/truth.ts
assertions:
  - type: count
    path: path/to/source/of/truth.ts
    pattern: 'regex matching one occurrence per counted item'
    equals: 0
links: []
owners: []
created: {{DATE}}
---

## Why

This value drifts when stated in prose; this record is the single place it is
asserted. Other docs must reference this record by ID instead of the number.

## How to update

When the underlying code legitimately changes, `memory check` fails naming this
record — bump `equals` here, then run `/memory-bank:sync`.
