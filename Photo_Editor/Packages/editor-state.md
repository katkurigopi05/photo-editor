---
tags: [package]
---

# @director/editor-state

The engine. Exposes the public API and holds the reducers, inverses, and
[[Concepts/Persistence]] contract.

```ts
createEditorState(): EditorState
executeCommand(state, input): CommandResult
undo(state): HistoryResult
redo(state): HistoryResult
replay(operations): ReplayResult
InMemoryPersistence
```

Implements the [[Concepts/Command Engine]], [[Concepts/Validation Precedence]],
[[Concepts/Undo Redo Replay]], and [[Concepts/Editor State]]. Builds an
importable ESM entry at `dist/index.js`.

Depends on [[Packages/project-schema]], [[Packages/command-schema]],
[[Packages/canonical-json]]. 96 tests across commands, validation, history,
replay, persistence, and [[Data Model/EffectInstance|effects]].
