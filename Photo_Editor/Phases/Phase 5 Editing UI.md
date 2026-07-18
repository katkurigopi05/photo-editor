---
tags: [phase]
---

# Phase 5 — Editing UI 🟡

Timeline, viewer, and inspector that emit commands. The **command boundary** and
a single mutation choke point are built now; the full visual browser shell lives
in `apps/web`.

**Boundary (non-negotiable):** UI never touches project state directly — all
mutations go through `EditorSession` (wraps `executeCommand`/`undo`/`redo`),
enforcing [[Rules/Non-negotiables|Rule 2]]. User input becomes canonical
[[Data Model/Microseconds|microsecond strings]]/validated payloads **before** a
command is built ([[Concepts/Determinism|Rule 6]]).

**Built:** [[Packages/ui-kit]] — pixel↔time units, per-command builders, a drag
resolver (move/trim), and `EditorSession`. Engine gained
`timeline.update_clip_effects`, closing the last gap so every UI action
dispatches a real validated command.

**Remaining:** pixel-level canvas rendering, DOM drag/drop, and a styled
component library (need a browser) — in the `apps/web` shell.

See [[Phases/Roadmap]].
