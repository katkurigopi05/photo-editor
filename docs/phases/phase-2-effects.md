# Phase 2 — Effects (state + command layer, built)

Phase 2's render/compositing engine (GPU) is future work. Its **project-state
layer** — the serializable effect model and the commands that edit it — is built
now in `editor-state`, fully deterministic and testable without a GPU.

## Data model

`TimelineClip` gains an ordered `effects: EffectInstance[]` stack:

```ts
interface EffectInstance {
  id: string;
  type: "color.brightness" | "color.contrast" | "transform.opacity" | "blur.gaussian";
  enabled: boolean;
  params: Record<string, JsonValue>; // validated per type
}
```

Effects are a Zod discriminated union on `type`; each type has a strict params
schema (brightness/contrast/opacity/gaussian). Params are JSON-serializable and
replayable — the same discipline as commands. The stack order is meaningful.

## Commands (all through the Foundation engine)

| Command                          | Inverse                       |
| -------------------------------- | ----------------------------- |
| `timeline.add_effect`            | `internal.remove_effect`      |
| `timeline.update_effect_params`  | `internal.set_effect_params` (prior params) |
| `timeline.remove_effect`         | `internal.insert_effect` (effect + exact index) |
| `timeline.reorder_effects`       | `internal.reorder_effects` (prior order) |

- A clip is created with `effects: []`; effects change only via these commands.
- `add_effect` appends and rejects a duplicate effect id (`DUPLICATE_ID`).
- `update_effect_params` re-validates new params against the target effect's
  type in the reducer (`VALIDATION_ERROR` on failure).
- `remove_effect` / `update_effect_params` / `reorder_effects` return
  `EFFECT_NOT_FOUND` when the effect is missing; `reorder_effects` requires a
  permutation of the existing effect ids.
- Every command has a well-defined inverse, so undo/redo and replay restore
  exact prior effect state (verified byte-for-byte).

## Not built (rest of Phase 2)

GPU compositor, effects **rendering** graph, color management, and the frame
cache — all require `wgpu` and pixel-hash fixtures and are deliberately not
stubbed. The state model above is the stable seam they will read from.
