---
tags: [concept]
---

# Editor State

The immutable value threaded through the [[Concepts/Command Engine]].

```ts
interface EditorState {
  project: Project | null;
  operationLog: ProjectOperation[]; // applied branch, in order
  undoStack: ProjectOperation[];    // mirrors operationLog (v1)
  redoStack: ProjectOperation[];
}
```

- `operationLog` length equals `project.currentVersion`.
- `undoStack` intentionally mirrors `operationLog` (reserved for future
  selective-undo); both stay consistent.
- `redoStack` holds undone [[Concepts/Project Operation|operations]]; any
  successful new command clears it.

Successive states use structural sharing; byte-equality comes from
[[Concepts/Canonical JSON]], never object identity. See [[Concepts/Undo Redo Replay]]
and [[Concepts/Persistence]].
