# Lessons

Append short entries only for real mistakes. Format: what broke, root cause, fix.

## 2026-07-19: rustup component flag
Wrong: `--component clippy rustfmt` (rustfmt parsed as second toolchain arg, crashed).
Fix: `--component clippy,rustfmt`.
Why: `--component` takes ONE value. Comma-separate multiple.

## 2026-07-19: background removal wiped whole photo
Wrong: default color-key tolerance 0.28 (28% of RGB-cube diagonal) — only worked on synthetic high-contrast test images.
Fix: tolerance 0.12, softness 0.10.
Why: never validated defaults against a realistic photo, only a synthetic test case.

## 2026-07-19: onnxruntime-web wasm load failed twice
Attempt 1: copied wasm/mjs into `/public/ort/`, set path prefix string — Vite dev server blocks dynamic import() from `/public`.
Attempt 2: removed override, let library self-resolve — path 404'd to SPA fallback HTML, WASM instantiate failed on bad magic bytes.
Fix: `ort.env.wasm.wasmPaths` accepts `{ wasm, mjs }` object form; resolve exact URLs via Vite's `?url` import suffix.
Why: didn't check the library accepted an object form before working around it twice.

## 2026-07-19: drag-and-drop broken in Photo mode
Root cause: earlier fix hid `#timeline` via `display:none` in Photo mode, removing the only drop target — a *side effect* of an unrelated UI change, not caught because drag-and-drop wasn't retested after that change.
Fix: added equivalent drop target on `#stage`.
Why: changing visibility of a UI element removed functionality attached to it. Retest adjacent features after hiding/removing DOM, not just the one you changed.

## 2026-07-19: drop overlay stuck visible after drop
Root cause: stage/lane drop handlers called `stopPropagation()` (needed to avoid double-import via window fallback handler), which also blocked the window handler's overlay-hide code from running.
Fix: lifted `hideDropOverlay()` to module scope, called explicitly from every drop handler, not just the window-level one.
Why: `stopPropagation()` silences ALL downstream listeners, not just the one causing the problem you're avoiding. Check what else depends on the event you're stopping.
