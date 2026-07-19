# AI background removal (real, local, no server)

A genuine deep-learning foreground-segmentation tool, alongside the existing
classical color-key one. This is the answer to "match the reference app's
background removal quality" — that app runs `rembg` (Python), which is a real
pretrained neural network, not a tunable number. There is nothing to "tune"
into the classical algorithm to match it; the fix is a different technique.

## What's real here

- **Model:** U²-Net (Xuebin Qin et al., Apache-2.0), the exact model `rembg`
  itself defaults to. Downloaded directly from `rembg`'s own GitHub release
  assets (`danielgatis/rembg`, tag `v0.0.0`) — not a third-party mirror.
- **Verified, not assumed:**
  - `u2netp.onnx` (bundled, 4.36 MB): MD5 checksum-verified against the exact
    value `rembg` publishes in its own source
    (`8e83ca70e441ab06c318d82300c84806`).
  - `u2net.onnx` (167.8 MB, not bundled — see below): downloaded once during
    development to independently compute a SHA-256, with its MD5 cross-checked
    against `rembg`'s published value (`60024c5c889badc19c04ad937298a77b`) too.
    That SHA-256 is pinned in code and re-verified against every byte the
    browser fetches, before any inference runs on it.
- **Preprocessing/postprocessing match `rembg`'s own code exactly** (resize to
  320×320, ImageNet mean/std normalization, min-max output normalization) —
  read directly from `rembg`'s `sessions/base.py` and `sessions/u2net.py`, not
  guessed.
- **Inference runs 100% client-side** via `onnxruntime-web` (WASM backend) —
  no server, no account, no per-image network call. Fits the "hold cloud/API
  phases for later" instruction: this is real ML, but it never leaves the
  browser.

## Two models, "download both"

| | Fast (default) | Accurate |
|---|---|---|
| Model | `u2netp` | `u2net` |
| Size | 4.36 MB | 167.8 MB |
| Delivery | Bundled in the app (`apps/web/public/models/`) | Fetched once on demand from `rembg`'s release URL, SHA-256 verified, cached in the browser's Cache Storage forever after |
| Why not bundle both | — | 167.8 MB exceeds GitHub's 100 MB push limit; would also bloat every page load for a mode most users won't pick |

## Architecture

- **`packages/bg-segmentation`** (pure-ish, DOM-light): `preprocessU2Net`,
  `postprocessU2Net` (5 unit tests, no ONNX runtime needed — pure array math),
  and `segmentForeground`/`configureOnnxRuntime` (the actual inference glue,
  browser-only, not unit tested — exercised live instead, see below).
- Output is a `Mask` — the exact same type Lasso and Magic Wand already
  produce. It plugs directly into the existing selection-actions panel
  (Invert/Clear/Feather/Delete/Fill) with zero new mask-manipulation code, plus
  one convenience button ("Remove Background (keep subject)") that does
  `applyMaskDelete(image, invertMask(foregroundMask))` in one click.
- New raster tool, `apps/web`'s Photo-mode "AI Remove Background", alongside
  the existing classical "Remove Background" — both stay available; the
  classical one is instant and dependency-free, the AI one is slower on first
  use (model load) but handles busy/textured backgrounds the color-key
  approach categorically cannot.

## A real Vite/bundler gotcha worth recording

`onnxruntime-web` resolves its `.wasm` binary and `.mjs` Emscripten loader by
constructing a path at runtime (`wasmPaths + filename`) and dynamically
`import()`-ing it. Two failure modes, both hit and fixed during this build:

1. Pointing `wasmPaths` at a string prefix under Vite's `/public` directory
   fails outright in dev — Vite's dev server explicitly refuses to serve
   `/public` files through a dynamic `import()` (by design: those files skip
   its transform pipeline entirely).
2. Leaving `wasmPaths` unset relies on `onnxruntime-web`'s own
   `import.meta.url`-relative resolution, which Vite's **production build**
   handles correctly (it auto-emitted a hashed wasm asset) but its **dev
   server** does not consistently — the computed path 404s to the SPA
   fallback, so `WebAssembly.instantiate()` fails on an HTML response's magic
   bytes instead of a real wasm binary.

Fix: `ort.env.wasm.wasmPaths` accepts an **object** (`{ wasm, mjs }`), not just
a prefix string. Resolve both files explicitly via Vite's `?url` import
suffix (which *is* bundler-analyzed correctly in both dev and build) and pass
the exact resolved URLs. See `configureOnnxRuntime` in
`packages/bg-segmentation/src/inference.ts` and its call site in
`apps/web/src/main.ts`.

## Verified live, not just unit-tested

Inference logic is browser/WASM-dependent and isn't meaningfully unit-testable
in Node. It was instead driven end-to-end in a real Chromium browser
(Playwright against the dev server): imported an adversarial synthetic photo
(textured background, subject color only moderately different from the
background — the exact case that drove the classical algorithm's default
tolerance down to 100% transparent, see the earlier "Remove Background wiping
out entire photos" fix) → ran AI segmentation (~1s real inference) → the
resulting selection precisely matched the subject's actual shape → "Remove
Background" produced a clean cutout with the textured background fully gone
and the subject fully intact. The classical tool cannot do this on the same
image at any sane tolerance; the AI tool did it correctly once the
`wasmPaths` wiring above was fixed (it failed twice before that, on both
wrong configurations) — both failures and the fix are recorded above so
they aren't rediscovered.

## License / attribution

U²-Net weights: Xuebin Qin et al., Apache License 2.0. Redistributed here
exactly as `rembg` (MIT) itself redistributes them from its GitHub releases —
same files, same checksums, cross-verified against `rembg`'s own published
checksums before use.
