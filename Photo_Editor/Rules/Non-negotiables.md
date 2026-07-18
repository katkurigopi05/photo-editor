---
tags: [rule]
---

# Non-negotiables

Rules inherited by every phase. Breaking any of these is a defect.

1. **Original media is never modified.** Edits are references + commands.
2. **Commands are the only public mutation path** — see [[Concepts/Command Engine]].
3. **Validate before mutate.** Raw input is [[Packages/project-schema|Zod]]-checked first.
4. **Rejected commands change nothing** — state stays deeply equal; version,
   history, and redo untouched. See [[Concepts/Validation Precedence]].
5. **Reducer inputs are immutable.** No caller-owned object is mutated.
6. **[[Concepts/Determinism|Deterministic]] reducers/replay** — no clock, IDs,
   randomness, I/O, or locale ordering.
7. **Time is [[Data Model/Microseconds|canonical microsecond strings]]**;
   `bigint` only transiently. See [[Decisions/ADR 0001 Decimal String Microseconds]].
8. **State is JSON-serializable.**
9. **Replay is byte-identical** via [[Concepts/Canonical JSON]].
10. **New command after undo clears redo.** See [[Concepts/Undo Redo Replay]].

Related: [[Decisions/ADR 0002 Deterministic Command Driven State]].
