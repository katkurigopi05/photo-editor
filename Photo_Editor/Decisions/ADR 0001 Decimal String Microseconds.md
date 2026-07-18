---
tags: [adr]
---

# ADR 0001 — Decimal-string microseconds

**Status:** Accepted.

**Context:** timeline times must be exact beyond hours of footage and
byte-stable for [[Concepts/Undo Redo Replay|replay]]. JS `number` loses precision
above 2^53 and isn't byte-stable; `bigint` isn't JSON-serializable.

**Decision:** persist times as [[Data Model/Microseconds|canonical decimal
strings]] (`^(0|[1-9][0-9]*)$`); do arithmetic in `bigint` transiently and
serialize back to a string. The [[Concepts/Canonical JSON|serializer]] throws if
a `bigint` ever reaches it.

**Consequences:** exact, unbounded, byte-stable state; derived
`timelineDurationUs`; mirrored by [[Crates/project-store]] in Rust.

Supports [[Rules/Non-negotiables|rule 7]].
