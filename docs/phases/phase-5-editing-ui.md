# Phase 5 — Editing UI (command boundary + session, built)

A full editor shell (timeline canvas, viewer, inspector) is a browser project.
Its **deterministic, testable core** — the layer that turns UI intent into
validated commands and routes every mutation through the engine — is built now
in `packages/ui-kit`, plus a working (non-headless) web shell in `apps/web`.

## Non-negotiable boundary

- UI code never touches project state directly: all mutations go through
  `EditorSession.dispatch/undo/redo`, which wraps `executeCommand`/`undo`/`redo`
  (Rule 2, enforced at one choke point).
- All user input is converted to canonical microsecond strings / validated
  payloads **before** a command is built (`units.ts`, `drag.ts`). Nothing in the
  boundary reads the clock or generates IDs — identity/time come from a
  caller-supplied `CommandContext` (Rule 6).

## Built (`packages/ui-kit`, pure)

- **Units** (`units.ts`): `pixelsToUs`, `pixelsToUsDelta`, `usToPixels`,
  `snapUsToFrame` (via the Phase 3 frame timing).
- **Command builders** (`commands.ts`): one per public command; UI intent +
  `CommandContext` → a fully-formed, typed command envelope.
- **Drag resolver** (`drag.ts`): `resolveClipDrag` turns a move/trim gesture
  (pixel delta + zoom) into a `move_clip` / `trim_clip` payload, clamped to
  legal ranges, in canonical microseconds.
- **`EditorSession`** (`session.ts`): the single mutation choke point; tracks
  `canUndo`/`canRedo` and the last error.

## Engine addition

`timeline.update_clip_effects` — replace a clip's entire effect stack in one
command (used by UI presets), validated and reversible. This closes the last gap
between `apps/web` and the engine, so every UI action now dispatches a real,
validated command.

## Tests

Component-level "UI action → command shape" (builders, drag geometry, unit
conversions) and an end-to-end session flow: import → add to timeline → trim →
preview (deterministic frame schedule) → undo → redo, plus rejected-command
atomicity.

## Not built (rest of Phase 5)

Pixel-level canvas rendering, real drag/drop DOM interaction, and a component
library with visual styling live in the `apps/web` shell and are not unit-tested
here (they need a browser). The `ui-kit` boundary is what they build on.
