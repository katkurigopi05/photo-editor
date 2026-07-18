---
tags: [package, phase-5]
---

# @director/ui-kit

The [[Phases/Phase 5 Editing UI|Phase 5]] UI→command boundary — pure and
framework-agnostic. Turns UI intent into validated commands and routes every
mutation through the [[Concepts/Command Engine]].

- **Units:** `pixelsToUs`, `pixelsToUsDelta`, `usToPixels`, `snapUsToFrame`
  (via [[Packages/playback-controller]] frame timing). Converts UI pixels to
  canonical [[Data Model/Microseconds]] at the boundary.
- **Command builders:** one per public command; UI intent + a `CommandContext`
  (caller-supplied id/time, no clock/randomness — [[Concepts/Determinism]]) →
  a typed [[Concepts/Command Envelope|command]].
- **Drag resolver:** `resolveClipDrag` → `move_clip` / `trim_clip` payloads,
  clamped, canonical.
- **`EditorSession`:** the single mutation choke point wrapping
  `executeCommand`/`undo`/`redo` — enforces [[Rules/Non-negotiables|Rule 2]].

The web shell `apps/web` uses this boundary; every UI action dispatches a real
validated command (including `timeline.update_clip_effects`).
