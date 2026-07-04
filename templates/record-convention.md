---
id: {{ID}}
title: {{TITLE}}
kind: convention
status: active
rule: "ONE line, imperative, terse (memory/STYLE.md if present) — agent applies without opening file."
anchors:
  - path: path/to/governed/file.ts
assertions:
  - type: forbidden
    glob: ":(glob)src/**/*.ts"
    pattern: 'the-anti-pattern-regex'
links: []
owners: []
created: {{DATE}}
---

## Why

What breaks when violated. <=3 lines, terse (memory/STYLE.md if present).

## How to apply

Which helper/pattern instead; where canonical example lives.
