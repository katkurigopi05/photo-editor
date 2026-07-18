# Project Director Foundation — Controlled Coding Benchmark (v2)

You are implementing the first trusted vertical slice of **Project Director**, an AI-native, nondestructive photo and video editor.

Work directly in the provided repository. Complete the task end to end. Do not ask for routine clarification; choose the safest minimal default, record it, and continue. Do not expose private chain-of-thought. A concise plan and factual progress reports are sufficient.

## Required reading

Before editing, read:

- `AGENTS.md`
- `docs/product/product-spec.md`
- `docs/architecture/system-architecture.md`
- `docs/architecture/project-document.md`
- all existing package manifests, source files, and tests

Then provide a concise implementation plan and list the files you expect to change.

## Objective

Create the initial monorepo foundation and implement a deterministic, validated, reversible, replayable project-operation engine.

This is a domain-foundation task. Do not implement media decoding, playback, rendering, authentication, databases, cloud infrastructure, collaboration, or AI integration.

## Required repository structure

Use:

- pnpm workspaces for TypeScript packages and applications;
- a Cargo workspace for Rust crates;
- TypeScript strict mode;
- Zod for runtime validation;
- Vitest for TypeScript tests;
- Rust standard tests;
- ESLint and Prettier;
- GitHub Actions for CI.

Create and configure:

```text
apps/desktop
apps/web
apps/api
packages/project-schema
packages/command-schema
packages/editor-state
crates/media-core
crates/timeline-engine
crates/project-store
docs/product
docs/architecture
docs/adr
```

Apps and Rust crates may be honest minimal scaffolds, but they must build. Do not create fake media or API behavior.

## Non-negotiable domain rules

1. Original media is never modified.
2. Commands are the only public project-mutation path.
3. Raw command input is validated before mutation.
4. A rejected command leaves state deeply equal to the prior state and does not alter version, history, or redo state.
5. Reducer inputs are treated as immutable. Do not mutate caller-owned objects.
6. Reducers and replay may not read the clock, generate IDs, use randomness, perform I/O, or use locale-dependent ordering.
7. Persisted time values are canonical decimal strings matching `^(0|[1-9][0-9]*)$` and represent nonnegative integer microseconds.
8. Use `bigint` only transiently for arithmetic; project state and operations must remain JSON serializable.
9. The same validated operation log must replay to byte-equivalent canonical JSON (see "Canonical JSON").
10. Successful new commands after an undo clear the redo branch.
11. All commands must be discriminated unions and have Zod validators.
12. Invalid input returns typed errors; do not throw for expected domain failures.
13. Do not weaken strictness, lint rules, or tests to get a green build.
14. Do not modify `.benchmark-lock.json`.

## Canonical JSON

"Byte-equivalent canonical JSON" means the output of a canonical serializer with these rules:

- object keys sorted lexicographically by UTF-16 code unit, recursively;
- arrays preserve element order;
- no insignificant whitespace;
- all state values are JSON-native (strings, numbers, booleans, null, arrays, objects); no `bigint` or `undefined` may reach the serializer — omit absent optional fields entirely.

Implement this serializer once in a shared package and use it wherever byte equality is asserted.

Timestamps (`createdAt`, `updatedAt`) are stored and re-emitted **verbatim** as the strings supplied in commands. Do not parse-and-reformat them; normalization would break byte equality. Validation may parse them to confirm they are ISO-8601 instants, but the stored value is the original string.

## Validation precedence

When multiple failures apply, report the first failing check in this order, so tests are deterministic:

1. Envelope structure and payload shape (Zod) → `VALIDATION_ERROR`
2. Project existence preconditions → `PROJECT_ALREADY_EXISTS` / `PROJECT_NOT_FOUND`
3. Version check (`baseVersion === project.currentVersion`, or `0` for `project.create`) → `VERSION_CONFLICT`
4. Referenced-entity existence → `ASSET_NOT_FOUND` / `SEQUENCE_NOT_FOUND` / `TRACK_NOT_FOUND` / `CLIP_NOT_FOUND`
5. Uniqueness → `DUPLICATE_ID`
6. Compatibility → `INCOMPATIBLE_TRACK`
7. Range and bounds → `INVALID_TIME_RANGE` / `OUT_OF_BOUNDS`
8. Overlap → `OVERLAP`

## Required version-one data model

You may add carefully justified fields, but the following data must exist and retain these semantics.

### Project

```ts
interface Project {
  id: string;
  ownerId: string;
  name: string;
  schemaVersion: 1;
  currentVersion: number;
  settings: {
    defaultFrameRate: Rational;
  };
  assets: MediaAsset[];
  sequences: Sequence[];
  createdAt: string;
  updatedAt: string;
}
```

### Rational

```ts
interface Rational {
  numerator: number;   // positive safe integer
  denominator: number; // positive safe integer
}
```

Rationals are not required to be reduced, except where a rule names an exact value (see playback rate).

### MediaAsset

```ts
interface MediaAsset {
  id: string;
  projectId: string;
  kind: "image" | "video" | "audio" | "generated";
  originalUri: string;
  checksum: string; // lowercase SHA-256 hex, matching ^[0-9a-f]{64}$
  metadata: {
    fileSizeBytes: string; // canonical decimal string matching ^(0|[1-9][0-9]*)$
    durationUs?: string;   // canonical decimal string; required before an asset can become a timeline clip, regardless of kind (an image used as a clip is given an explicit duration at registration)
    width?: number;        // positive safe integer when present
    height?: number;       // positive safe integer when present
    frameRate?: Rational;
  };
  createdAt: string;
}
```

### Sequence, Track, and TimelineClip

```ts
interface Sequence {
  id: string;
  name: string;
  width: number;   // positive safe integer
  height: number;  // positive safe integer
  frameRate: Rational;
  tracks: Track[];
}

interface Track {
  id: string;
  kind: "video" | "audio";
  name: string;
  index: number; // nonnegative safe integer
  clips: TimelineClip[];
}

interface TimelineClip {
  id: string;
  assetId: string;
  trackId: string;
  timelineStartUs: string;
  timelineDurationUs: string;
  sourceInUs: string;
  sourceOutUs: string;
  playbackRate: Rational;
}
```

For version one, the only accepted playback rate is exactly `numerator === 1` and `denominator === 1`. Reject unreduced equivalents such as `2/2` with `VALIDATION_ERROR`.

Calculate `timelineDurationUs` as `sourceOutUs - sourceInUs`; callers must not be able to supply a conflicting duration.

Source range bounds: `0 <= sourceInUs < sourceOutUs <= asset.metadata.durationUs`. A missing `durationUs` on the asset makes any clip using it invalid (`INVALID_TIME_RANGE` with a message naming the missing duration).

Clips on the same track use half-open ranges `[timelineStartUs, timelineStartUs + timelineDurationUs)` and may not overlap. Adjacent clips are valid. Moving or extending a clip must recheck overlap while excluding the clip being changed.

A video track accepts `video`, `image`, or `generated` assets. An audio track accepts `audio` or `video` assets. The benchmark fixtures use a video asset on a video track.

## Command envelope

Every public command contains:

```ts
interface CommandEnvelope {
  id: string; // RFC 4122 UUID, lowercase hyphenated form
  commandType: string;
  baseVersion: number; // nonnegative safe integer
  actor: {
    type: "user" | "agent" | "system";
    id: string;
  };
  createdAt: string; // ISO-8601 instant, stored verbatim
  payload: unknown;
}
```

All data that affects output must be present in the command. On success, the project's `updatedAt` becomes the command's `createdAt` string, byte for byte.

Implement these public command variants:

### `project.create`

```ts
payload: {
  projectId: string;
  ownerId: string;
  name: string;
  settings: { defaultFrameRate: Rational };
}
```

It is valid only when no project exists and `baseVersion` is `0`. The new project's `createdAt` and `updatedAt` are the command's `createdAt`.

### `asset.register`

```ts
payload: { asset: MediaAsset }
```

The asset project ID must match the current project. IDs are unique across their entity type. Duplicate asset IDs are rejected. Registering an asset does not read or modify the URI.

### `timeline.create_sequence`

```ts
payload: {
  sequence: Omit<Sequence, "tracks">;
}
```

Sequence dimensions are positive safe integers.

### `timeline.add_track`

```ts
payload: {
  sequenceId: string;
  track: Omit<Track, "clips">;
}
```

Track IDs are unique across the project. Track indices must be unique within a sequence (duplicate index → `DUPLICATE_ID` with a path pointing at `index`). Preserve deterministic track ordering by ascending `index`, then `id`.

### `timeline.add_clip`

```ts
payload: {
  sequenceId: string;
  trackId: string;
  clip: Omit<TimelineClip, "trackId" | "timelineDurationUs">;
  insertionIndex?: number;
}
```

Validate entity existence, asset/track compatibility, source range, asset duration, playback rate, unique clip ID, and non-overlap. `insertionIndex`, when present, must be an integer in `[0, track.clips.length]`; otherwise return `OUT_OF_BOUNDS`. When `insertionIndex` is absent, preserve deterministic ordering by `timelineStartUs` (numeric comparison of the canonical values), then `id`. An inverse operation may use `insertionIndex` to restore the exact prior position.

### `timeline.move_clip`

```ts
payload: {
  sequenceId: string;
  clipId: string;
  targetTrackId: string;
  timelineStartUs: string;
}
```

Validate target compatibility and non-overlap (excluding the moved clip itself). Preserve source range, duration, and playback rate. When moving within the same track or to a new track, the clip's position in the clip array follows the default deterministic ordering (`timelineStartUs`, then `id`) unless restored by an inverse with `insertionIndex`.

### `timeline.trim_clip`

```ts
payload: {
  sequenceId: string;
  clipId: string;
  sourceInUs: string;
  sourceOutUs: string;
}
```

Require `sourceOutUs > sourceInUs`, keep the source range within the asset duration, and recompute `timelineDurationUs`. `timelineStartUs` is unchanged by a trim. Check overlap if the duration grows (a shrinking or equal duration cannot introduce overlap).

### `timeline.delete_clip`

```ts
payload: {
  sequenceId: string;
  clipId: string;
}
```

Its inverse must restore the complete clip, original track, and original ordering (array position).

You may define internal-only validated inverse commands when necessary. Keep them separate from commands accepted from untrusted public input: `executeCommand` must reject internal command types arriving through the public boundary with `VALIDATION_ERROR`.

## Required operation and state semantics

Expose a serializable `ProjectOperation` containing at least:

```ts
interface ProjectOperation {
  id: string; // equal to the forward command ID
  baseVersion: number;
  resultingVersion: number; // always baseVersion + 1
  command: ProjectCommand;
  inverse: InternalProjectCommand;
  createdAt: string; // equal to the forward command's createdAt
  }
```

Expose an immutable editor state:

```ts
interface EditorState {
  project: Project | null;
  operationLog: ProjectOperation[]; // currently applied branch, in order
  undoStack: ProjectOperation[];
  redoStack: ProjectOperation[];
}
```

Note: in this version, `undoStack` always mirrors `operationLog`. This redundancy is intentional; it reserves room for future selective-undo semantics. Both must stay consistent.

`project.currentVersion` equals the number of currently applied operations. `project.create` produces version `1`. Undo removes the most recent applied operation from `operationLog` and `undoStack`, applies its inverse, and pushes the original operation onto `redoStack`. Redo reapplies the original command, restores it to `operationLog` and `undoStack`, and removes it from `redoStack`.

Redo reapplies a command that was previously valid against the exact state it now targets, so it must succeed; if reapplication fails, that indicates internal corruption — return `OPERATION_LOG_INVALID` with the prior state unchanged.

Undoing `project.create` returns to `project: null`. A successful new public command after undo clears `redoStack`.

Structural sharing between successive immutable states is allowed and encouraged; deep-freeze in tests if helpful, but do not rely on `Object.freeze` for correctness.

## Required public API

`packages/editor-state/src/index.ts` must export these names, and the package build must emit an importable ESM entry at `packages/editor-state/dist/index.js`:

```ts
export function createEditorState(): EditorState;

export function executeCommand(
  state: EditorState,
  commandInput: unknown
): CommandResult;

export function undo(state: EditorState): HistoryResult;

export function redo(state: EditorState): HistoryResult;

export function replay(
  operationsInput: readonly unknown[]
): ReplayResult;
```

Use these result shapes:

```ts
type CommandErrorCode =
  | "VALIDATION_ERROR"
  | "PROJECT_ALREADY_EXISTS"
  | "PROJECT_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "DUPLICATE_ID"
  | "ASSET_NOT_FOUND"
  | "SEQUENCE_NOT_FOUND"
  | "TRACK_NOT_FOUND"
  | "CLIP_NOT_FOUND"
  | "INCOMPATIBLE_TRACK"
  | "INVALID_TIME_RANGE"
  | "OUT_OF_BOUNDS"
  | "OVERLAP"
  | "HISTORY_EMPTY"
  | "OPERATION_LOG_INVALID";

interface CommandError {
  code: CommandErrorCode;
  message: string;
  path?: Array<string | number>;
  details?: Record<string, unknown>;
}

type CommandResult =
  | { ok: true; state: EditorState; operation: ProjectOperation }
  | { ok: false; state: EditorState; error: CommandError };

type HistoryResult =
  | { ok: true; state: EditorState; operation: ProjectOperation }
  | { ok: false; state: EditorState; error: CommandError };

type ReplayResult =
  | { ok: true; state: EditorState }
  | {
      ok: false;
      state: EditorState;
      error: CommandError;
      operationIndex: number; // index of the offending operation; -1 for failures not attributable to a single operation (e.g., input is not an array)
    };
```

Expected domain failures return `ok: false`; they do not throw. Unexpected programmer faults may throw, but do not use a blanket catch to turn bugs into misleading validation failures.

`replay` must:

1. validate each element's operation structure (`OPERATION_LOG_INVALID` on failure, with the element's index);
2. validate chain continuity: the first operation's `baseVersion` is `0`, each `resultingVersion === baseVersion + 1`, each subsequent `baseVersion` equals the prior `resultingVersion`, and each operation's `id` and `createdAt` equal its embedded command's envelope values;
3. reconstruct from an empty state by executing each forward command;
4. after each step, verify the recorded `resultingVersion` matches the produced version and the recorded `inverse` is byte-equal (canonical JSON) to the freshly computed inverse — reject mismatches with `OPERATION_LOG_INVALID` rather than silently trusting recorded metadata.

## Persistence interface

Add a small provider-independent persistence contract and an in-memory implementation for tests. It must save and load the serialized operation log (the source of truth); saving and loading full editor state may be layered on top. Loads and saves must not share mutable object references with callers (defensive copy or serialize/deserialize). Do not add a database.

## Required tests

At minimum, add tests for:

1. every valid public command;
2. malformed command envelopes and payloads;
3. canonical microsecond strings, including rejection of negatives, decimals, exponent notation, whitespace, leading zeros, empty strings, and non-string inputs;
4. version conflicts;
5. duplicate IDs (including duplicate track indices within a sequence);
6. missing entities and incompatible tracks;
7. source ranges outside asset duration, including `sourceOutUs > durationUs` and clips referencing assets without `durationUs`;
8. half-open overlap rules and valid adjacency;
9. failed-command atomicity and input immutability;
10. JSON serialization and round-trip parsing;
11. deterministic replay after JSON round trip;
12. replay rejection for tampered `id`, `baseVersion`, `resultingVersion`, command, and inverse;
13. undo and redo for every command;
14. delete-then-undo restoring exact clip order and values;
15. new edit after undo clearing redo;
16. undo and redo on empty history (`HISTORY_EMPTY`);
17. two independent executions of the same commands producing identical canonical JSON;
18. in-memory persistence defensive copying;
19. validation precedence: at least one case where two failures apply and the higher-precedence code is returned;
20. non-reduced playback rate (`2/2`) rejection;
21. `insertionIndex` out of bounds.

Use fixed IDs and timestamps in tests. Do not mock the clock because reducers must not access it.

## Documentation

Create or update:

- project schema documentation;
- command and operation model documentation;
- undo/redo and replay semantics;
- canonical JSON serialization rules;
- an ADR for decimal-string microseconds and transient `bigint` arithmetic;
- an ADR for deterministic command-driven state;
- repository setup and validation instructions.

## CI and quality gates

Configure root scripts and CI so the following are meaningful and include every relevant workspace package:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Run all available gates before completion. If the environment blocks dependency installation or a toolchain command, report the exact failure; do not claim it passed.

## Prohibited shortcuts

Do not:

- store timeline time as numbers;
- call `Date.now`, `new Date()` without a command-supplied value, `Math.random`, or UUID generation inside reducers or replay;
- mutate input state or command objects;
- bypass Zod with unchecked casts at the public boundary;
- implement undo with an unbounded full-project snapshot in each operation;
- make replay trust unvalidated operations;
- disable tests, strict TypeScript, or lint rules;
- edit `.benchmark-lock.json` (if the file is absent, treat its absence as out of scope — do not create it);
- add media, AI, authentication, database, or cloud features;
- claim a command passed when it was not run.

## Completion report

Create `implementation-report.json` with factual assumptions, files changed, tests added, commands run, failures, and limitations.

Your final response must contain:

1. **Implemented**
2. **Design decisions**
3. **Files changed**
4. **Tests added**
5. **Commands run and exact outcomes**
6. **Remaining limitations**

Begin by inspecting the repository and presenting the concise plan. Then implement and validate the task without waiting for additional approval.
