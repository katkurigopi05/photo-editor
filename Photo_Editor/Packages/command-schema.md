---
tags: [package]
---

# @director/command-schema

The [[Concepts/Command Envelope|command envelope]], the public command
discriminated union, the internal inverse commands, and the
[[Concepts/Project Operation]] schema — all Zod-validated.

- **Public commands:** create/register/sequence/track + clip add/move/trim/delete
  + [[Data Model/EffectInstance|effect]] add/update/remove/reorder.
- **Internal commands** (`internal.*`): inverses applied on undo; rejected at the
  public boundary by [[Packages/editor-state|executeCommand]].
- Enforces the v1 `1/1` playback rate at the schema boundary.

Depends on [[Packages/project-schema]]. Consumed by [[Packages/editor-state]].
