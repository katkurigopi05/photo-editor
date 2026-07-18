---
tags: [concept]
---

# Project Operation

A serializable, reversible, replayable record of one applied command.

```ts
interface ProjectOperation {
  id: string;               // equals the forward command id
  baseVersion: number;
  resultingVersion: number; // always baseVersion + 1
  command: ProjectCommand;  // the public forward command
  inverse: InternalProjectCommand; // applied on undo
  createdAt: string;        // equals the forward command createdAt
}
```

The **inverse** is an internal command (`internal.*`) rejected at the public
boundary. It is a pure function of prior state + the forward command, so
[[Concepts/Undo Redo Replay|replay]] can recompute and byte-compare it. Inverses
carry `restoreUpdatedAt` and, where order matters, an `insertionIndex`, so undo
restores exact prior state without a full-project snapshot.

Part of the [[Concepts/Editor State|operation log]]. See [[Concepts/Command Engine]].
