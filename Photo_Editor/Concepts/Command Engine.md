---
tags: [concept]
---

# Command Engine

The only public path that mutates a [[Data Model/Project|project]]. Lives in
[[Packages/editor-state]].

## Flow

1. `executeCommand(state, input)` receives untrusted input.
2. Internal command types are rejected at the boundary.
3. [[Packages/command-schema|Zod]] parses the [[Concepts/Command Envelope|envelope]]
   + payload → `VALIDATION_ERROR` on failure.
4. A reducer runs domain checks in [[Concepts/Validation Precedence|precedence order]]
   and returns the next immutable project plus an **inverse**.
5. A [[Concepts/Project Operation]] is appended to the log; the redo branch clears.

Reducers are pure — see [[Concepts/Determinism]]. All identifying and time data
arrives inside the [[Concepts/Command Envelope|command]].

## Commands

Public discriminated union: `project.create`, `asset.register`,
`timeline.create_sequence`, `timeline.add_track`, `timeline.add_clip`,
`timeline.move_clip`, `timeline.trim_clip`, `timeline.delete_clip`, and the
[[Data Model/EffectInstance|effect]] commands `timeline.add_effect`,
`timeline.update_effect_params`, `timeline.remove_effect`,
`timeline.reorder_effects`.

Every command has an inverse enabling [[Concepts/Undo Redo Replay]].

Related: [[Concepts/Editor State]] · [[Concepts/Persistence]] · [[Rules/Non-negotiables]]
