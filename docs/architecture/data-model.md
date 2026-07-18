# Data Model (version one)

All types are defined and validated in `@director/project-schema`. Optional
fields are **omitted** when absent (never set to `undefined`), so canonical
output is stable.

## Rational

```ts
interface Rational {
  numerator: number; // positive safe integer
  denominator: number; // positive safe integer
}
```

Not required to be reduced, except the clip playback rate (below).

## Project

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
  createdAt: string; // ISO-8601 instant, stored verbatim
  updatedAt: string; // ISO-8601 instant, stored verbatim
}
```

## MediaAsset

```ts
interface MediaAsset {
  id: string;
  projectId: string;
  kind: "image" | "video" | "audio" | "generated";
  originalUri: string;
  checksum: string; // ^[0-9a-f]{64}$
  metadata: {
    fileSizeBytes: string; // ^(0|[1-9][0-9]*)$
    durationUs?: string; // required before an asset can become a clip
    width?: number; // positive safe integer
    height?: number; // positive safe integer
    frameRate?: Rational;
  };
  createdAt: string;
}
```

## Sequence / Track / TimelineClip

```ts
interface Sequence {
  id: string;
  name: string;
  width: number;
  height: number;
  frameRate: Rational;
  tracks: Track[];
}

interface Track {
  id: string;
  kind: "video" | "audio";
  name: string;
  index: number; // nonnegative safe integer
  clips: TimelineClip[];
}

interface TimelineClip {
  id: string;
  assetId: string;
  trackId: string;
  timelineStartUs: string;
  timelineDurationUs: string; // derived: sourceOutUs - sourceInUs
  sourceInUs: string;
  sourceOutUs: string;
  playbackRate: Rational; // v1: exactly 1/1
  audioGainDb: number; // Phase 4: default 0, range [-60, 12]
  audioPan: number; // Phase 4: default 0 (center), range [-1, 1]
  effects: EffectInstance[]; // ordered effect stack (Phase 2)
}
```

## EffectInstance (Phase 2)

```ts
interface EffectInstance {
  id: string;
  type: "color.brightness" | "color.contrast" | "transform.opacity" | "blur.gaussian";
  enabled: boolean;
  params: Record<string, JsonValue>; // validated per type
}
```

Effects are a Zod-validated discriminated union on `type`; each type has a
strict, JSON-serializable params schema (e.g. `color.brightness` →
`{ amount: number in [-1, 1] }`). The stack order is meaningful and preserved.
A clip is created with `effects: []`; effects are added, updated, removed, and
reordered only through commands. No GPU handles or non-serializable values ever
enter project state.

## Invariants

- **Time is a string.** All microsecond fields are canonical decimal strings;
  arithmetic uses `bigint` transiently and serializes back to a string.
- **Playback rate.** v1 accepts exactly `{numerator:1, denominator:1}`;
  unreduced equivalents such as `2/2` are rejected with `VALIDATION_ERROR`.
- **Clip duration.** `timelineDurationUs = sourceOutUs - sourceInUs`; callers
  cannot supply a conflicting value (it is omitted from clip input).
- **Source bounds.** `0 <= sourceInUs < sourceOutUs <= asset.durationUs`. An
  asset without `durationUs` cannot back a clip (`INVALID_TIME_RANGE`).
- **Overlap.** Clips on a track use half-open ranges
  `[start, start + duration)`; they may be adjacent but not overlapping.
- **Track ordering.** Deterministic by ascending `index`, then `id`.
- **Clip ordering.** Deterministic by numeric `timelineStartUs`, then `id`
  (unless an explicit `insertionIndex` restores an exact position).
- **Track compatibility.** A video track accepts `video`/`image`/`generated`;
  an audio track accepts `audio`/`video`.
