---
tags: [crate]
---

# timeline-engine

Pure, deterministic timeline primitives mirroring the TypeScript rules — no
clock, randomness, or I/O.

- `Rational` (positive terms, `reduced()` via gcd) — mirrors [[Data Model/Rational]].
- `Interval` — half-open `[start, start + duration)` with `overlaps()`; adjacency
  does not overlap, matching [[Data Model/TimelineClip]].

Built in the [[Phases/Phase 0 Foundation|Foundation]] phase; compiles native +
(later) WASM.
