---
id: CONV-001
title: No LEGACY_PALETTE token
kind: convention
status: active
rule: "Never reference LEGACY_PALETTE in src/ — it was removed in favour of PALETTE_VERSION."
anchors:
  - path: src
assertions:
  - type: forbidden
    glob: "src/**/*.ts"
    pattern: 'LEGACY_PALETTE'
links: []
owners: [selftest]
created: 2026-06-12
---

## Why

Selftest fixture: demonstrates the `forbidden` assertion (anti-pattern ban over
a glob) and a directory-prefix anchor.

## How to apply

Use `PALETTE_VERSION` from `src/sample.ts`.
