---
tags: [package]
---

# @director/canonical-json

The single [[Concepts/Canonical JSON|canonical serializer]] used everywhere byte
equality is asserted.

## API
- `canonicalStringify(value)` — sorted-key, whitespace-free JSON; throws on
  `bigint`/non-finite/`undefined` array elements.
- `canonicalEqual(a, b)`
- `deepClone(value)` — canonical round-trip, no shared references.
- `deepFreeze(value)` — test helper.

No dependencies. Consumed by [[Packages/editor-state]] and the schema packages.
