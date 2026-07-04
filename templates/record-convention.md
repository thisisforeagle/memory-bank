---
id: {{ID}}
title: {{TITLE}}
kind: convention
status: active
rule: "ONE line, imperative, caveman-terse (see memory/STYLE.md) — agent applies without opening file."
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

What breaks when violated. <=3 lines, terse (memory/STYLE.md).

## How to apply

Which helper/pattern instead; where canonical example lives.
