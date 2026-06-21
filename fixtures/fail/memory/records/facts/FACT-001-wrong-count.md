---
id: FACT-001
title: Color union size (deliberately wrong)
kind: fact
status: active
rule: "Selftest fixture: this record claims 99 members but the code has 3 — check MUST fail."
anchors:
  - path: src/sample.ts
assertions:
  - type: count
    path: src/sample.ts
    pattern: '^\s*\| "'
    equals: 99
links: []
owners: [selftest]
created: 2026-06-12
---

## Why

Negative fixture: proves the checker fails on count drift.
