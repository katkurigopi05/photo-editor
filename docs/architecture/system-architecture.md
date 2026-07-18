# System Architecture — Foundation

## One core, two shells

The domain core is shared by both desktop and web shells. The TypeScript layer
(`editor-state` and, in later phases, the UI) is identical on both targets; only
the bridge to native/WASM rendering will differ later.

```
apps/desktop ─┐
apps/web ─────┼──▶ @director/editor-state ──▶ @director/command-schema ──▶ @director/project-schema
apps/api ─────┘                        └──▶ @director/canonical-json ◀────────────┘

crates/  media-core · timeline-engine · project-store   (native + WASM in later phases)
```

## Package responsibilities

| Package                   | Responsibility                                                        |
| ------------------------- | -------------------------------------------------------------------- |
| `@director/canonical-json`| The single canonical serializer used wherever byte equality matters. |
| `@director/project-schema`| Domain types + Zod validators (Rational, Asset, Sequence, Clip, ...).|
| `@director/command-schema`| Command envelope, public discriminated union, internal inverses, `ProjectOperation`. |
| `@director/editor-state`  | `executeCommand`, `undo`, `redo`, `replay`, persistence contract.    |

Dependencies point downward only; there are no cycles.

## Data flow

1. Untrusted input enters `executeCommand(state, input)`.
2. Internal command types are rejected at the boundary.
3. Zod parses the envelope + payload → `VALIDATION_ERROR` on failure.
4. The matching reducer runs domain checks in a fixed precedence order and, on
   success, returns the next immutable project plus an **inverse** command.
5. A `ProjectOperation` (forward command + inverse + versions) is appended to
   the operation log and undo stack; the redo stack is cleared.

Reducers are pure: no clock, no IDs, no randomness, no I/O, no locale ordering.
All identifying and time data arrives inside the command.

## History and replay

- `undo` applies the recorded inverse, pops the operation log/undo stack, and
  pushes the operation onto the redo stack.
- `redo` re-executes the original forward command.
- `replay(log)` reconstructs state from an empty project, validating structure,
  chain continuity, and recorded metadata, and re-deriving each inverse to
  compare byte-for-byte against the recorded one.

See [`history-and-replay.md`](./history-and-replay.md) and
[`command-model.md`](./command-model.md).

## Determinism boundary

Structural sharing is used between successive immutable states. Byte-equivalence
is guaranteed by the canonical serializer (`canonical-json.md`), never by object
identity or `Object.freeze`.
