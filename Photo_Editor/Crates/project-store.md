---
tags: [crate]
---

# project-store

Provider-independent persistence primitives mirroring the TypeScript
[[Concepts/Persistence]] contract — no database.

- `Microseconds` — canonical decimal parse/format matching
  [[Data Model/Microseconds]] (`^(0|[1-9][0-9]*)$`).
- `OperationLogStore` trait + `InMemoryOperationLogStore` — copies bytes on save
  and load, so stored data never aliases caller buffers.

Built in the [[Phases/Phase 0 Foundation|Foundation]] phase.
