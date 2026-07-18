---
tags: [crate]
---

# media-core

Pixel/color type declarations **and** real read-only image decoding
([[Phases/Phase 1 Media Decoding]] slice).

- `PixelFormat` (`Rgba8`/`Rgb8`/`Yuv420p`), `ColorSpace` (`Srgb`/`Rec709`/`Rec2020`).
- `decode_image`, `probe_image`, `probe_dimensions` via the `image` crate
  (pure-Rust `png` + `zune-jpeg`). Typed `DecodeError`; never panics on bad input.
- Golden-file tests on committed real PNG/JPEG fixtures (exact pixels for PNG).

Decoding is strictly read-only. Video/audio/RAW decode remain future
[[Phases/Phase 1 Media Decoding|Phase 1]] work. Compiles native + (later) WASM.
