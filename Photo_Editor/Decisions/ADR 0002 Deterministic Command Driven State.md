---
tags: [adr]
---

# ADR 0002 — Deterministic, command-driven state

**Status:** Accepted.

**Context:** undo/redo, replay, and future collaboration/AI edits require state to
be a pure function of an ordered, validated command history.

**Decision:**
- Commands are the only mutation path; internal inverses are rejected at the
  boundary. See [[Concepts/Command Engine]].
- Validate before mutate; typed errors, never throw for expected failures.
- [[Concepts/Determinism|Pure reducers]]; immutable inputs via structural sharing.
- Reversible operations derived purely from prior state (no full snapshots).
- Self-verifying [[Concepts/Undo Redo Replay|replay]] via
  [[Concepts/Canonical JSON]].

**Consequences:** testable determinism; future phases add command types without
bypassing the engine; playback/export/job state lives outside the engine.

Encodes [[Rules/Non-negotiables]].
