---
id: FACT-001
title: Color union size
kind: fact
status: active
rule: "Color in src/sample.ts currently has 3 members; never hardcode this count in prose."
anchors:
  - path: src/sample.ts
    symbol: 'export type Color'
assertions:
  - type: count
    path: src/sample.ts
    pattern: '^\s*\| "'
    equals: 3
  - type: symbol-exists
    path: src/sample.ts
    pattern: 'export type Color'
links: []
owners: [selftest]
created: 2026-06-12
---

## Why

Selftest fixture: demonstrates the `count` + `symbol-exists` assertion pair on
a union type — the canonical "volatile count" FACT record.

## How to update

Add a member to `Color`, run `memory check --root fixtures/pass`, watch it
fail, bump `equals`.
