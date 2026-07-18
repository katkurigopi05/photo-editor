---
tags: [data-model]
---

# Microseconds

All timeline times and byte counts are **canonical decimal strings** matching
`^(0|[1-9][0-9]*)$` — no sign, no leading zeros (except `"0"`), no decimals,
no exponent, no whitespace.

- Arithmetic uses `bigint` **transiently**, then serializes back to a string.
- Keeps state exact beyond 2^53 and byte-stable for [[Concepts/Canonical JSON]].

Rationale: [[Decisions/ADR 0001 Decimal String Microseconds]]. Rust mirror:
[[Crates/project-store]] `Microseconds`.
