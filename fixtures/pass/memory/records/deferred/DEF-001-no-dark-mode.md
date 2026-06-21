---
id: DEF-001
title: Dark mode intentionally not implemented
kind: deferred
status: active
rule: "There is deliberately no dark-mode palette — do not add one; scheduled for v2."
anchors: []
assertions:
  - type: none
    reason: "intentional absence — nothing to assert until it ships"
links: []
owners: [selftest]
created: 2026-06-12
---

## Why deferred

Selftest fixture: demonstrates a `deferred` record with an explicit `none`
assertion (kept honest in coverage stats).

## Trigger to revisit

v2 design phase.
