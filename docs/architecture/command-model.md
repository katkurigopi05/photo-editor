# Command & Operation Model

## Command envelope

```ts
interface CommandEnvelope {
  id: string; // RFC 4122 UUID, lowercase hyphenated
  commandType: string;
  baseVersion: number; // nonnegative safe integer
  actor: { type: "user" | "agent" | "system"; id: string };
  createdAt: string; // ISO-8601 instant, stored verbatim
  payload: unknown;
}
```

All data that affects output is in the command; the engine reads no ambient
state. Commands are a Zod-validated discriminated union on `commandType`.

## Public commands

| `commandType`               | Effect                                                        |
| --------------------------- | ------------------------------------------------------------ |
| `project.create`            | Create the project (only when none exists, `baseVersion 0`). |
| `asset.register`            | Add an asset (projectId must match; unique id).              |
| `timeline.create_sequence`  | Add a sequence (unique id).                                  |
| `timeline.add_track`        | Add a track (unique id; unique index within the sequence).  |
| `timeline.add_clip`         | Place a clip (validates compatibility, range, overlap).     |
| `timeline.move_clip`        | Move a clip (target compatibility, overlap excluding self). |
| `timeline.trim_clip`        | Change source range; recompute duration; re-check overlap only if it grows. |
| `timeline.delete_clip`      | Remove a clip; inverse restores it at its exact position.   |
| `timeline.add_effect`       | Append a validated effect to a clip's stack (unique effect id). |
| `timeline.update_effect_params` | Replace an effect's params (re-validated against its type). |
| `timeline.remove_effect`    | Remove an effect; inverse restores it at its exact index.   |
| `timeline.reorder_effects`  | Reorder a clip's effect stack by a permutation of effect ids. |
| `timeline.set_clip_audio_gain` | Set a clip's audio gain in dB (validated range). |
| `timeline.set_clip_audio_pan`  | Set a clip's stereo pan in [-1, 1].              |

## Validation precedence

When multiple failures apply, the first in this order is returned so tests are
deterministic:

1. Envelope/payload shape (Zod) → `VALIDATION_ERROR`
2. Project existence → `PROJECT_ALREADY_EXISTS` / `PROJECT_NOT_FOUND`
3. Version check → `VERSION_CONFLICT`
4. Referenced-entity existence → `ASSET_NOT_FOUND` / `SEQUENCE_NOT_FOUND` / `TRACK_NOT_FOUND` / `CLIP_NOT_FOUND`
5. Uniqueness → `DUPLICATE_ID`
6. Compatibility → `INCOMPATIBLE_TRACK`
7. Range and bounds → `INVALID_TIME_RANGE` / `OUT_OF_BOUNDS`
8. Overlap → `OVERLAP`

Effect commands add `EFFECT_NOT_FOUND` (referenced effect missing) at the
existence tier; new effect params are validated against the target effect's type
inside the reducer, returning `VALIDATION_ERROR` on failure.

Expected domain failures return `{ ok: false, error }`; they do not throw.

## Operations and inverses

Every applied command is recorded as a `ProjectOperation`:

```ts
interface ProjectOperation {
  id: string; // equals the forward command id
  baseVersion: number;
  resultingVersion: number; // always baseVersion + 1
  command: ProjectCommand; // the public forward command
  inverse: InternalProjectCommand; // applied on undo
  createdAt: string; // equals the forward command createdAt
}
```

Inverses are **internal** commands (`internal.*`) that are never accepted from
public input — `executeCommand` rejects them with `VALIDATION_ERROR`. Each
inverse is a pure function of the prior state and the forward command, so it is
reproducible during replay. Inverses carry `restoreUpdatedAt` and, where array
position matters (`insert_clip`, `move_clip`), an `insertionIndex`, so undo
restores exact prior state without storing a full-project snapshot.

## Result shapes

```ts
type CommandResult =
  | { ok: true; state: EditorState; operation: ProjectOperation }
  | { ok: false; state: EditorState; error: CommandError };
```

`CommandError` carries `code`, `message`, and optional `path` and `details`.
