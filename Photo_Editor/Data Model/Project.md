---
tags: [data-model]
---

# Project

The serializable source of truth for a user's work. Mutated only via the
[[Concepts/Command Engine]]; always JSON-native.

```ts
interface Project {
  id: string;
  ownerId: string;
  name: string;
  schemaVersion: 1;
  currentVersion: number;
  settings: { defaultFrameRate: Rational };
  assets: MediaAsset[];
  sequences: Sequence[];
  createdAt: string;
  updatedAt: string;
}
```

- `currentVersion` = number of applied operations (`project.create` → 1).
- On success, `updatedAt` becomes the command's `createdAt` (verbatim).

Contains [[Data Model/MediaAsset|assets]] and [[Data Model/Sequence|sequences]].
Uses [[Data Model/Rational]] and [[Data Model/Microseconds]]. Defined in
[[Packages/project-schema]].
