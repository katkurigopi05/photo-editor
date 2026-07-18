# Project Director — Full Build Roadmap
### Photo, Video & Audio Editor — Shared Core (Desktop + Web)

## How to use this file

A production photo/video/audio editor cannot be built from one prompt the way the
Foundation slice was. It's built in **phases**, where each phase is its own
implementation contract with the same rigor as `FOUNDATION_BENCHMARK_PROMPT.md`
(data model, required APIs, non-negotiable rules, required tests). This file is
the roadmap: it defines what each phase covers, the order they depend on, and
the architecture that ties them together as one shared core for both desktop
and web.

Treat each `## Phase` section below as the seed for its own detailed prompt,
written the same way as the Foundation one, when you're ready to build it.
Do not try to execute all phases in a single pass — each is a large project
on its own.

---

## Architecture: one core, two shells

```text
crates/                        (Rust — compiled to native + WASM)
  media-core/                  decoding, color, pixel formats
  timeline-engine/              (built in Foundation phase)
  project-store/                (built in Foundation phase)
  render-engine/                GPU compositing, effects graph
  audio-engine/                 mixing, resampling, waveform
  export-engine/                encode + mux

packages/                      (TypeScript)
  project-schema/               (built in Foundation phase)
  command-schema/               (built in Foundation phase)
  editor-state/                 (built in Foundation phase)
  render-bridge/                typed bindings to render-engine (native + WASM)
  playback-controller/          transport, scrubbing, frame cache
  ui-kit/                       shared design-system components (desktop + web)

apps/
  desktop/                      Tauri (Rust native) shell around the core
  web/                          Browser shell; render-engine compiled to WASM/WebGPU
  api/                          thin service for later cloud phases (not built yet)
```

**Why shared core, native + WASM:** the same Rust crates compile two ways —
natively for desktop (via Tauri, full filesystem/GPU/codec access) and to
WASM for the browser (via WebGPU/WebCodecs, sandboxed). The TypeScript layer
(`editor-state`, UI) is identical on both; only the bridge to `render-engine`
differs by target. This is why the Foundation phase mandated a Rust workspace
alongside the TypeScript one — it's load-bearing for every later phase.

**Non-negotiable across all phases (inherited from Foundation):**
- Original media is never modified — all edits are non-destructive commands over references.
- Every mutation to project state goes through the command/reducer engine from the Foundation phase. New phases add new command types; they do not bypass the engine.
- No phase weakens the determinism rules (no clock/randomness/locale-dependent code in reducers or replay).

---

## Phase 0 — Foundation *(already specified)*

Deterministic project/timeline data model, command engine, undo/redo/replay.
See `FOUNDATION_BENCHMARK_PROMPT.v2.md`. Every later phase depends on this.

**Status:** spec complete, not yet marked built.

---

## Phase 1 — Media Decoding (`crates/media-core`)

Turn `MediaAsset.originalUri` references into actual decodable pixels/samples.

**Scope:**
- Image decode: JPEG, PNG, WebP, HEIC/HEIF, TIFF, RAW (via `image`, `rawler`/`libraw` bindings).
- Video demux + decode: MP4/MOV (H.264, H.265, ProRes), WebM (VP9/AV1), via `ffmpeg-next` or `symphonia`+`dav1d`/platform hardware decoders on native; `WebCodecs` on web.
- Audio decode: WAV, AAC, MP3, FLAC via `symphonia`.
- Container/codec probing to populate `MediaAsset.metadata` (durationUs, width, height, frameRate) at `asset.register` time — this becomes a **new required step** before `asset.register` can succeed with real metadata, replacing the Foundation phase's caller-supplied metadata with probed values.
- Checksum computation (SHA-256) of source bytes at import time.
- Proxy/transcode generation for smooth scrubbing of heavy source formats (background job, does not block the command engine).

**New command types:** `asset.import` (reads file, probes, computes checksum, then emits `asset.register` with verified metadata) — a workflow command layered above the pure Foundation command, not a replacement for it.

**Non-negotiable:**
- Decoding is read-only. No decode path may write to `originalUri`.
- Probed metadata must be validated through the same Zod schemas as Foundation before being placed into a command payload — no unchecked casts.
- Platform decoder differences (hardware vs. software, native vs. WASM) must not change project *state* — only pixel output. State stays platform-independent.

**Required tests:** golden-file decode correctness per codec/container; probe accuracy against known fixtures; checksum stability; graceful rejection of corrupt/unsupported files with typed errors (no panics/throws across the FFI boundary).

---

## Phase 2 — Render & Compositing Engine (`crates/render-engine`)

Turn timeline state (from Phase 0) + decoded frames (from Phase 1) into a
composited frame for preview or export.

**Scope:**
- GPU pipeline via `wgpu` (portable across Metal/Vulkan/DX12/WebGPU) so the same code targets desktop and browser.
- Compositor: per-track blending, opacity, transform (position/scale/rotate/crop), respecting track stacking order from the timeline model.
- Effects graph: a node-based, serializable effect stack per clip (color correction, LUTs, blur, basic filters). Effect parameters live in project state (Foundation's JSON-serializable rule applies: no GPU handles or non-serializable state in `Project`).
- Color management: working color space, defined conversion at decode and at output.
- Frame cache with explicit eviction policy (memory-bounded), keyed by (clip, source time, effect-stack hash) so identical requests are cheap.

**New data model additions (extends Foundation's `TimelineClip`):**
```ts
interface EffectInstance {
  id: string;
  type: string;         // discriminated union, Zod-validated like commands
  params: Record<string, JsonValue>;
  enabled: boolean;
}
// TimelineClip gains: effects: EffectInstance[]
```
New commands: `timeline.add_effect`, `timeline.update_effect_params`,
`timeline.remove_effect`, `timeline.reorder_effects` — all go through the
Phase 0 command engine, with the same validate → reduce → invert contract
(effect add/remove/reorder must have well-defined inverses for undo).

**Non-negotiable:**
- Render output must be a pure function of (project state at version N, requested time) — no hidden mutable renderer state that affects output.
- The renderer never mutates `Project`; it only reads it and produces pixels.
- Effect parameter schemas follow the Foundation rule: validated by Zod, JSON-serializable, replayable.

**Required tests:** deterministic pixel-hash output for a fixed project + time across repeated renders; effect undo/redo restoring exact prior visual output; cache correctness under eviction.

---

## Phase 3 — Playback & Scrubbing (`packages/playback-controller`)

The transport layer: turns "user drags the playhead" into renderer calls at
interactive frame rates, on both native and web.

**Scope:**
- Frame-accurate seek using `frameRate`/`Rational` from the timeline model.
- Look-ahead prefetch and decode scheduling so playback doesn't stall on cache misses.
- A/V sync: audio clock drives video frame selection during playback (industry-standard approach) to avoid drift.
- Scrub modes: full-quality (paused), reduced-quality/proxy (dragging), matching what NLEs do to stay responsive.

**Non-negotiable:**
- Playback state (current time, play/pause, loop region) is UI/session state, **not** part of `Project` — it must not go through the command engine or appear in `operationLog`. Keep this boundary explicit so replay/undo semantics from Foundation stay untouched by playback.

**Required tests:** frame-index-to-time and time-to-frame-index round trips at various frame rates (including non-integer, e.g. 30000/1001); sync drift bounds over a long simulated playback; seek correctness at clip boundaries and half-open edges.

---

## Phase 4 — Audio Engine (`crates/audio-engine`)

**Scope:**
- Sample-accurate mixing of overlapping audio/video-audio clips per the timeline model, respecting `sourceInUs`/`sourceOutUs`/`playbackRate` (Foundation currently fixes playback rate to 1/1 for v1 — this phase should flag if variable-rate audio is needed, since pitch/time-stretch is a real design decision, not a default).
- Per-clip gain, pan, and a basic effects chain (EQ, compressor) using the same `EffectInstance` pattern as Phase 2, applied to audio tracks.
- Resampling to a single project sample rate for mix-down.
- Waveform data generation for UI display (peak/RMS buckets), cached like Phase 2's frame cache.
- Output routing: monitor (live preview) mix vs. export mix — same graph, different sinks.

**New commands:** `timeline.set_clip_audio_gain`, `timeline.set_clip_audio_pan`, plus the shared `add_effect`/`update_effect_params`/`remove_effect` commands from Phase 2 applied to audio-capable clips.

**Non-negotiable:**
- Mixing is deterministic given project state + time range — same rule as rendering.
- No audio command may implicitly alter video timing or vice versa; cross-modal effects (e.g., "duck music under dialogue") are modeled as explicit, inspectable state, not hidden heuristics.

**Required tests:** mix determinism/reproducibility; gain/pan correctness at known dB values; waveform cache correctness; overlap/mix behavior at clip boundaries.

---

## Phase 5 — Editing UI (`apps/desktop`, `apps/web`, `packages/ui-kit`)

**Scope:**
- Timeline view: tracks, clips, drag/trim/split interactions that emit Foundation commands (never mutate state directly from UI code).
- Viewer/preview panel wired to Phase 2 render output and Phase 3 playback controller.
- Inspector panels for clip/effect/audio parameters, editing `EffectInstance.params` via commands.
- Media bin / import flow wired to Phase 1.
- Command-driven undo/redo UI (thin wrapper over Phase 0's `undo`/`redo`).
- Shared `ui-kit` components so desktop (Tauri/native webview) and web render identically; platform-specific chrome (menus, file dialogs) stays in `apps/desktop` vs. `apps/web` respectively.

**Non-negotiable:**
- UI code never bypasses `executeCommand`/`undo`/`redo` to touch project state — this is the enforcement point for Foundation's Rule 2 ("Commands are the only public project-mutation path").
- All user-facing input (drag positions, typed values) is converted to canonical microsecond strings / validated payloads *before* being handed to the command engine, not after.

**Required tests:** component tests for command dispatch (UI action → expected command shape); end-to-end tests for at least: import → add to timeline → trim → export preview → undo → redo.

---

## Phase 6 — Export (`crates/export-engine`)

**Scope:**
- Encode: H.264/H.265 (native, via hardware or `ffmpeg`), VP9/AV1 (native + web via WASM encoders where feasible), image sequence, audio-only export.
- Mux: combine rendered video + mixed audio into standard containers (MP4, MOV, WebM) with correct timestamps derived from the canonical microsecond model.
- Export presets (resolution, bitrate, codec) as validated, serializable settings — following the same Zod-schema discipline as commands.
- Progress/cancellation as a stateful job outside the command engine (like playback state in Phase 3), reporting against immutable project state at the version it started from.

**Non-negotiable:**
- Export must never depend on live playback/UI state — only on a specific project version, so exports are reproducible and can run headless (e.g., later on `apps/api`).
- Export failures are typed and recoverable, not silent partial files.

**Required tests:** round-trip fixture (known small project → export → re-decode → verify duration/frame count/audio length within tolerance); codec/container matrix smoke tests; cancellation leaves no partial/corrupt output file.

---

## Explicitly deferred (not in this roadmap yet)

Per the Foundation phase's exclusions, these remain future work and are
**not** part of "the whole editor" as scoped here:
- AI-assisted editing features (the product's eventual differentiator, but a distinct phase requiring its own product spec).
- Authentication, cloud sync, multi-user collaboration.
- A real database/backend for `apps/api` (currently a scaffold only).

## Suggested build order

Phase 0 → 1 → 2 → 3 (playback needs both decode and render) → 5 (UI needs a
working preview loop to be testable) → 4 (audio can develop in parallel with
2/3 but needs UI to be user-testable) → 6 (export depends on render + audio
being stable).

## Next step

Tell me which phase to turn into a full implementation prompt (same format
as the Foundation one — data model, required APIs, non-negotiable rules,
required tests, CI gates) and I'll write that phase's document next. Phase 1
(media decoding) is the natural next one, since Phases 2–6 all depend on it.
