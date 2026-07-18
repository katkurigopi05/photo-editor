---
tags: [data-model, phase-2]
---

# EffectInstance

A validated effect on a [[Data Model/TimelineClip|clip]]'s ordered effect stack.
Introduced in [[Phases/Phase 2 Effects]].

```ts
interface EffectInstance {
  id: string;
  type: "color.brightness" | "color.contrast" | "transform.opacity" | "blur.gaussian";
  enabled: boolean;
  params: Record<string, JsonValue>; // validated per type
}
```

- Zod discriminated union on `type`; each type has a strict params schema
  (e.g. `color.brightness` → `{ amount: number in [-1, 1] }`).
- JSON-serializable and replayable — no GPU handles in state.
- Stack order is meaningful.

## Commands
`timeline.add_effect`, `timeline.update_effect_params`, `timeline.remove_effect`,
`timeline.reorder_effects` — all through the [[Concepts/Command Engine]], each
with a well-defined inverse for [[Concepts/Undo Redo Replay]]. Missing effect →
`EFFECT_NOT_FOUND`.
