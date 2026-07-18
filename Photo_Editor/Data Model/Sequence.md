---
tags: [data-model]
---

# Sequence

A canvas with tracks, inside a [[Data Model/Project]].

```ts
interface Sequence {
  id: string;
  name: string;
  width: number; height: number;
  frameRate: Rational;
  tracks: Track[];
}
```

Created via `timeline.create_sequence` (with `tracks: []`). Holds
[[Data Model/Track|tracks]], ordered deterministically. Uses [[Data Model/Rational]].
