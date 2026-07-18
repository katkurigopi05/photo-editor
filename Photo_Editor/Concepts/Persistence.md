---
tags: [concept]
---

# Persistence

A provider-independent contract; the serialized [[Concepts/Project Operation|operation]]
log is the source of truth. `InMemoryPersistence` (for tests) serializes on save
and parses on load, so stored data never shares references with callers.

```ts
interface PersistenceProvider {
  saveOperationLog(ops): Promise<void>;
  loadOperationLog(): Promise<ProjectOperation[]>;
  saveEditorState(state): Promise<void>;
  loadEditorState(): Promise<EditorState | null>;
}
```

No database in this phase. The Rust side mirrors this with
[[Crates/project-store]]. See [[Concepts/Editor State]].
