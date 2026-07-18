# Phase 1 — Media Decoding (in progress)

Turns `MediaAsset.originalUri` references into real decodable pixels. See the
roadmap for full scope. This document tracks what is **actually built** vs.
what remains, so the repo never claims fake media behavior.

## Built now — real image decode (`crates/media-core`)

Genuine, read-only decoding via the `image` crate (pure-Rust `png` + `zune-jpeg`
backends — no system libraries, so CI needs no extra setup):

```rust
decode_image(&[u8]) -> Result<DecodedImage, DecodeError>   // normalized 8-bit pixels
probe_image(&[u8])  -> Result<ImageMetadata, DecodeError>  // width, height, format
probe_dimensions(&[u8]) -> Result<(u32, u32), DecodeError> // cheap, no full decode
```

- RGBA-capable inputs normalize to `Rgba8`; everything else to `Rgb8`.
- Decoding is strictly read-only; no path writes to any source.
- All failures are typed (`DecodeError::{UnsupportedFormat, Corrupt}`); corrupt,
  truncated, or non-image bytes return an error and never panic.

**Tests** (`crates/media-core/tests/golden.rs`) use committed real fixtures:

- PNG RGB → exact pixel assertions (every pixel pure red).
- RGBA PNG → alpha preserved exactly.
- JPEG → correct dimensions/format; lossy pixels checked within tolerance.
- Cheap dimension probe correctness.
- Corrupt and truncated input rejected without panic.

## Not built (remaining Phase 1 scope)

These require heavy dependencies and golden fixtures and are deliberately **not**
stubbed (stubs would violate the "no fake media behavior" rule):

- Video demux/decode (H.264/265, ProRes, VP9/AV1); WebCodecs on web.
- Audio decode (WAV/AAC/MP3/FLAC).
- HEIC/HEIF, TIFF, and RAW image formats.
- WebP (feature is available in the `image` crate but not yet enabled/tested).
- The `asset.import` workflow command (read file → probe → checksum → emit a
  validated `asset.register`). The pure `asset.register` command already exists
  in the Foundation engine; `asset.import` layers I/O above it and belongs with
  the container/codec probing work.
- Proxy/transcode generation.

## Contract for the rest of the phase

When the remaining work is built, it must obey the Foundation non-negotiables:
probed metadata is validated through the same Zod schemas before entering a
command payload (no unchecked casts); platform decoder differences change only
pixel output, never project state.
