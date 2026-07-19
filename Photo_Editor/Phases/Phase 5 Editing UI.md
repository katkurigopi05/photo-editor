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

**Also built:** [[Packages/raster-tools]] — a full Photo-mode raster editing
toolset (Move/Crop/Transform/Brush/Eraser/Clone/Lasso/Wand/Sharpen/Smart
Fill/Remove Background), pure pixel algorithms + tested, with its own bounded
local undo/redo outside the command engine. "Apply" is the only path back in,
via a real `asset.register` command.

**Remaining:** raster tools for Video mode, DOM drag/drop on the timeline, and
a fuller styled component library — in the `apps/web` shell.

See [[Phases/Roadmap]].
