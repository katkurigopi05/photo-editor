# Product Spec — Project Director (Foundation)

## Vision

Project Director is an AI-native, non-destructive editor for photos, video, and
audio, sharing one deterministic core across desktop and web shells. Every edit
is a reversible command over references to original media; originals are never
altered.

## Scope of this phase (Phase 0 — Foundation)

This phase delivers the trusted domain core only:

- A versioned project/timeline data model.
- A command engine that validates, applies, inverts, and replays edits.
- Undo/redo and deterministic replay with byte-equivalent canonical JSON.
- A provider-independent persistence contract with an in-memory implementation.

Explicitly **out of scope** this phase: media decoding/probing, rendering,
playback, audio mixing, export, authentication, databases, cloud, collaboration,
and AI features. See `PROJECT_DIRECTOR_FULL_BUILD_ROADMAP.md`.

## Core product guarantees

- **Non-destructive.** Editing produces new project versions; source media is
  referenced by URI and checksum, never mutated.
- **Deterministic.** The same sequence of validated commands always produces the
  same project state, bit for bit, on any machine.
- **Reversible.** Every command has a well-defined inverse; undo/redo restore
  exact prior state.
- **Replayable.** A project's history is a serialized operation log that
  reconstructs state and is self-verifying against tampering.

## User-facing concepts

- **Project** — the top-level document: settings, registered assets, sequences.
- **Asset** — a reference to source media with probed/declared metadata.
- **Sequence** — a canvas with tracks.
- **Track** — an ordered lane (video or audio) holding clips.
- **Clip** — a placed, trimmed reference to an asset on a track's timeline.

Concrete field-level definitions live in
[`../architecture/data-model.md`](../architecture/data-model.md).
