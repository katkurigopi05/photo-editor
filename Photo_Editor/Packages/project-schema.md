---
tags: [package]
---

# @director/project-schema

The domain data model and its Zod validators.

Defines: [[Data Model/Rational]], [[Data Model/Microseconds|microsecond/decimal
strings]], checksum + ISO-instant schemas, [[Data Model/MediaAsset]],
[[Data Model/Sequence]], [[Data Model/Track]], [[Data Model/TimelineClip]],
[[Data Model/EffectInstance]], and [[Data Model/Project]] — plus track
compatibility rules and a JSON-value schema.

Optional fields are **omitted** when absent (never `undefined`), keeping
[[Concepts/Canonical JSON|canonical output]] stable. Depends on
[[Packages/canonical-json]]. Consumed by [[Packages/command-schema]] and
[[Packages/editor-state]].
