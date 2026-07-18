---
tags: [concept]
---

# Determinism

The same validated command sequence always produces the same state, bit for bit,
on any machine.

Enforced by:
- **Pure reducers** — no `Date.now`/`new Date()`, `Math.random`, UUID generation,
  I/O, or locale-dependent ordering. All identity/time data is in the
  [[Concepts/Command Envelope|command]].
- **Explicit ordering** — numeric (`bigint`) time comparisons and code-unit id
  tiebreakers (clips by `timelineStartUs` then `id`; tracks by `index` then `id`).
- **[[Concepts/Canonical JSON]]** for byte-equality.
- **Self-verifying [[Concepts/Undo Redo Replay|replay]]**.

Guaranteed testable: two independent runs and a post-serialization replay produce
identical canonical JSON. See [[Decisions/ADR 0002 Deterministic Command Driven State]]
and [[Rules/Non-negotiables]].
