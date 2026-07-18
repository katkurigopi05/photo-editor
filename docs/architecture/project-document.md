# Project Document Model

The **project document** is the single serializable source of truth for a user's
work. It is mutated only through commands and is always JSON-native.

## Editor state

```ts
interface EditorState {
  project: Project | null;
  operationLog: ProjectOperation[]; // currently applied branch, in order
  undoStack: ProjectOperation[]; // mirrors operationLog in this version
  redoStack: ProjectOperation[];
}
```

- `project` is `null` before `project.create` and after undoing it.
- `operationLog` holds the applied branch in order; its length equals
  `project.currentVersion`.
- `undoStack` intentionally mirrors `operationLog` (reserved for future
  selective-undo); both are kept consistent.
- `redoStack` holds operations that were undone and can be redone; it is cleared
  by any successful new command.

## Versioning

- `project.create` produces `currentVersion = 1`.
- Each successful command increments `currentVersion` by exactly 1.
- Undo sets `currentVersion` back to the operation's `baseVersion`.
- A command is accepted only when its `baseVersion` equals the project's current
  version (`0` for `project.create`), else `VERSION_CONFLICT`.

## Timestamps

`createdAt` / `updatedAt` are stored **verbatim** as supplied in commands — never
parsed and reformatted — so canonical byte equality holds. On success,
`project.updatedAt` becomes the command's `createdAt`. Undo restores the prior
`updatedAt`, which each inverse carries as `restoreUpdatedAt`.

## Persistence

The serialized operation log is the source of truth. `PersistenceProvider`
(with `InMemoryPersistence` for tests) saves/loads it and, optionally, full
editor state. Saves and loads serialize/parse, so stored data never shares
references with callers.

Full field definitions: [`data-model.md`](./data-model.md).
