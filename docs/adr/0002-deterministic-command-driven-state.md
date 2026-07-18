# ADR 0002 — Deterministic, command-driven state

## Status

Accepted.

## Context

The editor must support undo/redo, replay, and (later) collaboration and AI
agents proposing edits. All of these require that project state be a pure
function of an ordered, validated command history — with no dependence on the
clock, randomness, machine locale, or ambient I/O.

## Decision

- **Commands are the only mutation path.** `executeCommand` is the sole public
  entry that changes `project`; internal inverse commands are rejected at this
  boundary.
- **Validate before mutate.** Every command is parsed by Zod (discriminated
  union + strict payloads) before any reducer runs. Expected failures return
  typed `CommandError`s; they do not throw.
- **Pure reducers.** Reducers never call `Date.now`/`new Date()`,
  `Math.random`, generate UUIDs, perform I/O, or sort by locale. All identifying
  and time data is supplied inside the command. Ordering uses explicit numeric
  (`bigint`) and code-unit comparisons.
- **Immutability.** Reducers treat inputs as immutable and return new immutable
  states via structural sharing; caller-owned objects are never mutated. A
  rejected command returns the prior state object unchanged.
- **Reversible operations.** Each command produces an inverse derived purely
  from prior state, enabling bounded undo without full-project snapshots.
- **Self-verifying replay.** Replay recomputes versions and inverses and compares
  them byte-for-byte (canonical JSON) against recorded values, so it never
  trusts unvalidated metadata.

## Consequences

- Determinism is testable: two independent runs and a post-serialization replay
  produce identical canonical JSON.
- Future phases add new command types but must not bypass the engine or weaken
  these rules.
- Playback, export, and other session/job state must live **outside** the
  command engine and operation log (see the roadmap), preserving these
  guarantees.
