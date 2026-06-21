---
id: {{ID}}
title: {{TITLE}}
kind: convention
status: active
rule: "ONE-LINE imperative rule an agent can apply without opening this file."
anchors:
  - path: path/to/governed/file.ts
assertions:
  - type: forbidden
    glob: "src/**/*.ts"
    pattern: 'the-anti-pattern-regex'
links: []
owners: []
created: {{DATE}}
---

## Why

The rationale. What breaks (or has broken) when this convention is violated.

## How to apply

Concrete instructions: which helper/predicate/pattern to use instead, where the
canonical example lives.
