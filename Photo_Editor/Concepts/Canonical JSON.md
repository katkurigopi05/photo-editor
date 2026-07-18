---
tags: [concept]
---

# Canonical JSON

The single serializer used wherever byte-equivalence matters (replay
verification, determinism, persistence). Lives in [[Packages/canonical-json]].

## Rules
- Object keys sorted by **UTF-16 code unit**, recursively.
- Arrays preserve order.
- No insignificant whitespace.
- JSON-native values only; `bigint`, non-finite numbers, and `undefined` array
  elements **throw**; `undefined` object properties are skipped.

## Timestamps
`createdAt` / `updatedAt` are stored and re-emitted **verbatim** — never
parse-and-reformat, which would break byte equality.

Underpins [[Concepts/Undo Redo Replay]] and [[Concepts/Determinism]]. See
[[Decisions/ADR 0001 Decimal String Microseconds]].
