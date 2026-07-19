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

**Video gets the same pattern, video-shaped:** `transform.crop` — a real,
Zod-validated, undoable `Effect` (like `transform.rotate`/`transform.flip`)
for non-destructive reframing, since a live video stream can't be
destructively pixel-cropped the way a photo can. Plus **"Edit Current
Frame"** — grabs the exact frame under the playhead (waits for the real
`seeked` event, never a stale frame) and opens it in the *same* raster
editor built for photos, full reuse, for touch-ups/rotoscoping/thumbnails.

**Remaining:** DOM drag/drop on the timeline and a fuller styled component
library — in the `apps/web` shell.

See [[Phases/Roadmap]].
