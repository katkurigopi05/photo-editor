---
tags: [data-model]
---

# MediaAsset

A reference to source media. Registered via `asset.register`; the original is
never read or modified (see [[Rules/Non-negotiables]]).

```ts
interface MediaAsset {
  id: string;
  projectId: string;
  kind: "image" | "video" | "audio" | "generated";
  originalUri: string;
  checksum: string; // ^[0-9a-f]{64}$
  metadata: {
    fileSizeBytes: string;   // canonical decimal
    durationUs?: string;     // required before it can back a clip
    width?: number; height?: number;
    frameRate?: Rational;
  };
  createdAt: string;
}
```

A [[Data Model/TimelineClip]] can only reference an asset with a `durationUs`.
Real image decoding/probing is [[Phases/Phase 1 Media Decoding|Phase 1]] (built
for PNG/JPEG in [[Crates/media-core]]). Uses [[Data Model/Rational]] and
[[Data Model/Microseconds]].
