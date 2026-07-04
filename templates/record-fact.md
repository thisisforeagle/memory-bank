---
id: {{ID}}
title: {{TITLE}}
kind: fact
status: active
rule: "ONE line, caveman-terse: the volatile fact + where it lives — never hardcode value in prose."
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

Value drifts when stated in prose; asserted here, once. Other docs reference
this record ID, not the number.

## How to update

Legit code change → `memory check` fails naming this record — bump `equals`
here, then `/memorybank:sync`.
