---
tags: [concept]
---

# Validation Precedence

When multiple failures apply, the first in this order is returned, so results are
deterministic:

1. Envelope/payload shape (Zod) → `VALIDATION_ERROR`
2. Project existence → `PROJECT_ALREADY_EXISTS` / `PROJECT_NOT_FOUND`
3. Version → `VERSION_CONFLICT`
4. Referenced entity → `ASSET_NOT_FOUND` / `SEQUENCE_NOT_FOUND` /
   `TRACK_NOT_FOUND` / `CLIP_NOT_FOUND` / `EFFECT_NOT_FOUND`
5. Uniqueness → `DUPLICATE_ID`
6. Compatibility → `INCOMPATIBLE_TRACK`
7. Range and bounds → `INVALID_TIME_RANGE` / `OUT_OF_BOUNDS`
8. Overlap → `OVERLAP`

Expected domain failures return `{ ok: false, error }`; they never throw. See
[[Concepts/Command Engine]].
