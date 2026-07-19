---
tags: [package]
---

# bg-segmentation

Real deep-learning foreground segmentation — the honest answer to "match the
reference editor's background removal." That app runs `rembg` (a real
pretrained U²-Net model), not a tunable threshold, so there was nothing to
tune into [[Packages/raster-tools|the classical color-key tool]] to match it.
This package runs the **same U²-Net weights** `rembg` uses, downloaded
directly from its own release assets and checksum-verified, via
`onnxruntime-web` — 100% client-side, no server, no per-image network call.

- `preprocessU2Net` / `postprocessU2Net` — pure array math (resize + ImageNet
  mean/std normalize; min-max normalize + resize back), matching `rembg`'s own
  preprocessing exactly. 5 unit tests.
- `segmentForeground` — the inference glue (browser-only; verified live via
  Playwright, not unit-tested, since it needs a real WASM/DOM environment).
- Two models: `u2netp` (4.4 MB, bundled in `apps/web/public/models/`) and
  `u2net` (167.8 MB, fetched once on demand + SHA-256-verified + cached in
  Cache Storage — too large for GitHub's 100 MB push limit to bundle).

Output is a `Mask` — the same type [[Packages/raster-tools]]'s Lasso/Wand
produce, so it composites through the *existing* selection-actions panel with
zero new mask code. Wired into `apps/web`'s Photo-mode raster editor as "AI
Remove Background", alongside (not replacing) the classical tool.

See `docs/phases/ai-background-removal.md` for the full provenance/checksum
trail and a real Vite dev-server `wasmPaths` gotcha worth not rediscovering.
