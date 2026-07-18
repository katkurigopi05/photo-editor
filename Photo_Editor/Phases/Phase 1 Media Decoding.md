---
tags: [phase]
---

# Phase 1 — Media Decoding 🟡

Turn [[Data Model/MediaAsset|asset]] references into real decodable pixels/samples.

**Built now (real, no fakery):** read-only PNG/JPEG decode + probe in
[[Crates/media-core]] via the `image` crate, with golden-file tests on committed
fixtures.

**Remaining (needs heavy deps + fixtures, deliberately not stubbed):** video
demux/decode, audio decode, HEIC/TIFF/RAW/WebP, the `asset.import` workflow
command (read → probe → checksum → validated `asset.register`), and proxy
generation.

**Contract:** probed metadata is validated through the same
[[Packages/project-schema|Zod schemas]] before entering a command; platform
decoder differences change only pixels, never [[Data Model/Project|state]].
