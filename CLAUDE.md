# Project Director

Local-first, deterministic photo/video/audio editor. pnpm workspace + Cargo workspace monorepo.

## Core invariant
All project mutations go through validated commands (packages/editor-state) — reducer engine, undo/redo/replay. No direct state mutation. Original media never modified (non-destructive).

Raster pixel editing (brush/crop/clone/AI bg-remove) is a SEPARATE local session, deliberately OUTSIDE the command engine — like playback/export state. Only committed via `asset.register` command on Apply.

## Key packages
- `packages/editor-state` — command/reducer engine, canonical JSON, microsecond time as decimal strings, Rational frame rates
- `packages/project-schema` — Zod schemas, EffectInstance discriminated union
- `packages/bg-segmentation` — real ONNX U²-Net inference (onnxruntime-web/wasm), same weights as rembg
- `apps/web/src/main.ts` — main app (large file, Read before editing)

## Gotchas
- Vite dev server blocks dynamic `import()` from `/public`. Use `?url` import suffix for bundler-resolved asset URLs (see onnxruntime wasm/mjs loading in main.ts).
- `rustup --component` takes ONE value — comma-separate multiple: `--component clippy,rustfmt`.
- AGPLv3 reference app (Odysseus/rembg UX pattern) — never copy code, only reimplement from first principles or official upstream source.

## Testing standard
Verify UI fixes LIVE via Playwright against running dev server, not just unit tests or code review. User has repeatedly caught claimed-but-unverified fixes.

## Full gate before commit
TS: lint, typecheck, test, build, format:check. Rust: fmt --check, clippy -D warnings, test.

## Before risky changes
Check `LESSONS.md` — past mistakes and root causes, so you don't repeat them.

## Docs
- `PROJECT_DIRECTOR_FULL_BUILD_ROADMAP.md` — phase roadmap (Phase 7 cloud/AI deferred)
- `docs/phases/` — technical writeups per feature
- `Photo_Editor/` — Obsidian vault, Phase/Package notes with wikilinks (never commit `.obsidian/workspace.json`)
