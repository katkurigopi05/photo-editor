# ADR 0001 — Decimal-string microseconds with transient `bigint` arithmetic

## Status

Accepted.

## Context

Timeline positions and durations must be exact to the microsecond, support
values well beyond hours of footage, and survive JSON serialization with
byte-identical output for deterministic replay. JavaScript `number` is an IEEE
754 double: integers above 2^53 lose precision, and JSON number formatting is
not guaranteed to be byte-stable across engines/values. `bigint` is exact but is
**not** JSON-serializable and must never reach the canonical serializer.

## Decision

- Persist all microsecond values (and byte counts) as **canonical decimal
  strings** matching `^(0|[1-9][0-9]*)$`: no sign, no leading zeros (except
  `"0"`), no decimals, no exponent, no whitespace. Zod enforces this at the
  boundary.
- Perform arithmetic by converting to `bigint` **transiently**
  (`BigInt(x) - BigInt(y)`), then serializing the result back to a string with
  `.toString()`, which yields exactly the canonical form for nonnegative
  integers.
- The canonical serializer throws if a `bigint` ever reaches it, guaranteeing no
  transient value leaks into persisted state.

## Consequences

- State is exact, unbounded within `u64`-scale ranges, and byte-stable.
- Comparisons (`ordering`, `overlap`) go through `bigint`, so they are precise.
- Callers cannot supply `timelineDurationUs`; it is derived
  (`sourceOutUs - sourceInUs`) to avoid conflicting values.
- The Rust `project-store::Microseconds` type mirrors the same canonical
  parse/format rules for cross-language consistency.
