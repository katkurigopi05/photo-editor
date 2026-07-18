---
tags: [data-model]
---

# Rational

```ts
interface Rational {
  numerator: number;   // positive safe integer
  denominator: number; // positive safe integer
}
```

Used for frame rates and [[Data Model/TimelineClip|clip]] playback rate. Not
required to be reduced — **except** the v1 clip playback rate, which must be
exactly `1/1`; unreduced equivalents like `2/2` are rejected with
`VALIDATION_ERROR`.

Mirrored in Rust by [[Crates/timeline-engine]]. Defined in
[[Packages/project-schema]].
