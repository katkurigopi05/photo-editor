# AGENTS.md — Project Director

Project Director is an AI-native, non-destructive photo/video/audio editor. This
repository currently contains **Phase 0 (Foundation)**: a deterministic,
validated, reversible, replayable project-operation engine. Later phases (media
decoding, render, playback, audio, export) are described in
`PROJECT_DIRECTOR_FULL_BUILD_ROADMAP.md` and are **not** built yet.

## Layout

```
apps/desktop|web|api      honest scaffolds around the shared core (no fake behavior)
packages/canonical-json   byte-equivalent canonical JSON serializer
packages/project-schema   domain data model + Zod validators
packages/command-schema   command envelope, discriminated unions, inverse commands
packages/editor-state     the engine: executeCommand / undo / redo / replay
crates/media-core         pixel/color type declarations (decoding is a later phase)
crates/timeline-engine    pure Rational + half-open interval primitives
crates/project-store      canonical microseconds + in-memory operation-log store
docs/                     product, architecture, ADRs, setup
```

## Non-negotiable rules (inherited by every future phase)

1. Original media is never modified.
2. Commands are the only public project-mutation path.
3. Raw command input is validated (Zod) before any mutation.
4. A rejected command leaves state deeply equal to the prior state and does not
   alter version, history, or redo state.
5. Reducer inputs are immutable; caller-owned objects are never mutated.
6. Reducers and replay never read the clock, generate IDs, use randomness,
   perform I/O, or use locale-dependent ordering.
7. Persisted time is a canonical decimal string of nonnegative integer
   microseconds (`^(0|[1-9][0-9]*)$`). `bigint` is used only transiently.
8. Project state and operations are JSON-serializable.
9. The same validated operation log replays to byte-equivalent canonical JSON.
10. Successful new commands after an undo clear the redo branch.

## Working in this repo

- TypeScript is strict; do not weaken `tsconfig`, ESLint, or tests to get green.
- Run the full gate set before claiming completion — see `docs/setup.md`.
- User-facing mode or feature changes must update `docs/USER_MANUAL.md` and
  `docs/Project_Director_User_Manual.docx`. Visible mode-UI changes must also
  refresh the affected images under `docs/assets/user-manual/`. Run
  `pnpm manual:check`; see `docs/user-manual-maintenance.md`.
- Do not edit `.benchmark-lock.json` (currently absent; do not create it).
- Do not add media decoding, rendering, playback, auth, databases, or cloud in
  this phase.
