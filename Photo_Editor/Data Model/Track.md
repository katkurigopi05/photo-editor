---
tags: [data-model]
---

# Track

An ordered lane holding clips inside a [[Data Model/Sequence]].

```ts
interface Track {
  id: string;
  kind: "video" | "audio";
  name: string;
  index: number; // nonnegative safe integer
  clips: TimelineClip[];
}
```

- Deterministic order: ascending `index`, then `id`.
- **Compatibility:** a video track accepts `video`/`image`/`generated`; an audio
  track accepts `audio`/`video`.
- Track ids are unique across the project; `index` is unique within the sequence.

Holds [[Data Model/TimelineClip|clips]]. Added via `timeline.add_track`.
