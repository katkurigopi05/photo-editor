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

## Phase 7 — Cloud Platform & AI-Assisted Editing *(deferred, distinct scope)*

Everything in Phases 0–6 is local-first and deterministic: no server, no
database, no auth, no calls to an AI model. Phase 7 is where the product
would grow a cloud backend and real generative AI (object removal,
generative fill, background replacement/outpainting, subject
masking/tracking, upscaling) — a genuinely different order of investment
(hosted infra, GPU cost, model licensing/hosting), not just more local code.
It is deliberately **not** part of "the whole editor" scoped by Phases 0–6.
The following is distilled from a full reference architecture
(`ai-photo-video-editing-architecture.md`) down to the load-bearing
decisions worth keeping when this phase is actually specified:

**Already validated by Phases 0–6 — no rework needed when this phase starts:**
- *Non-destructive editing = three separate things*: immutable original
  asset, a structured edit graph, and generated derivatives. This is
  exactly `MediaAsset` (immutable) + the command/operation log + the raster
  editor's "Apply → register a new derived asset" flow (Phase 5's photo/video
  raster tools) — the cloud version just adds AI-generated derivatives to
  the same shape.
- *Async jobs report `{jobId, status, progress}` over a push channel*, not a
  blocking request. Phase 6's `ExportJob` state machine (`running` →
  `completed`/`failed`/`cancelled`, bound to a specific project version) is
  this pattern already, just local and synchronous-enough not to need a
  queue yet.
- *The renderer/exporter consumes a frozen, versioned project state, never
  live UI state.* Phase 6's `planExport` (pure function of project version +
  preset) already satisfies this; the cloud render stages (freeze version →
  resolve assets → build plan → render → mux → QC → deliver) are the same
  shape with more steps.

**The one design decision that matters most (keep this when specifying Phase 7):**
> The most important boundary is between the **editor** and the **AI
> implementation**. The editor expresses user intent in a stable format
> ("remove this object", "replace this region", "preserve the face",
> "upscale to 4K"). A **Model Gateway** decides which model, provider, GPU
> pool, and parameters fulfill that intent — so the timeline, project
> system, UI, and rendering engine never need to change when the underlying
> AI model changes.

**Scope, when specified for real:**
- *Backend services*: Auth (workspace roles: owner/admin/editor/reviewer/
  viewer), Project/Asset/Timeline services backed by a real database
  (`apps/api` is currently a scaffold only), signed direct-to-storage
  uploads (large media must not transit the API gateway).
- *AI Model Gateway*: one internal contract for every AI op (validate input
  → safety/policy check → route to external provider or internal GPU model →
  post-process → automated quality check → result). Model-specific
  parameters live behind the gateway; the client never sends
  provider-specific settings.
- *Job orchestration*: `CREATED → VALIDATING → QUEUED → PREPROCESSING →
  RUNNING → POSTPROCESSING → QUALITY_CHECK → COMPLETED`, with
  `FAILED`/`CANCELED`/`TIMED_OUT`/`REJECTED` as terminal alternatives. Each
  stage restartable — a failed final render must not repeat expensive AI
  inference. (Phase 6's local `ExportJob` should adopt `TIMED_OUT` as a
  distinct terminal state even before Phase 7, since "the export hung" and
  "the export failed" are different, actionable facts for a caller.)
- *GPU worker pools, separated by workload* (segmentation, image generation,
  video generation, upscaling, tracking, rendering, CPU media) — each with
  its own scaling method, since a queue-depth-scaled inpainting pool and a
  duration-scaled render pool have nothing in common operationally.
- *Proxy-first video editing*: on import, generate a low-res editing proxy,
  thumbnail strip, audio waveform, keyframes, and shot-boundary detection;
  edit against the proxy, apply the same edit graph to the original at
  export time. Note: proxy/thumbnail/waveform generation itself needs no
  cloud or AI — it's a good candidate to pull *earlier*, as a background-job
  enhancement to Phase 1 (decode) and Phase 4 (waveform), once there's a
  real async job runner to put it on.
- *Video AI's hard problem is temporal consistency*, not per-frame quality.
  A robust approach combines: shot-aware processing (never run a temporal
  pass across a hard cut), keyframe conditioning (edit reference frames
  first), mask propagation via object tracking (with user corrections as
  tracking anchors), overlapping frame windows with blended/consistency-
  scored seams, identity conditioning (reusable embeddings for the edited
  subject), motion-aware generation (optical flow/depth/camera motion as
  conditioning), a final temporal-correction pass (flicker, color drift,
  edge/mask jitter, lighting), and compositing only the regenerated region
  over untouched original pixels wherever possible (cheaper and safer).
- *Photo AI quality control*: compare pixels **outside** the requested edit
  mask against the source; reject or regenerate candidates that change
  unrequested regions beyond a configured tolerance. Cheap, effective, and
  worth adopting as the acceptance test for any future generative op.
- *Security/privacy, additive to Phase 0's rules*: encryption in transit/at
  rest, short-lived signed asset URLs (never expose raw storage paths),
  workspace-level authorization checked per project/asset/job/export,
  malware scanning + media type/codec validation on upload (Phase 1's
  decoder already rejects corrupt/unsupported files — extend the same
  discipline to a real upload boundary), prompt/output safety checks before
  and after any AI call, per-workspace rate limits, and explicit handling
  for the Model Gateway not leaking user metadata to third-party providers.

**Not carried forward as-is:** the reference architecture's specific product
choices (Kafka/Postgres/Redis/Kubernetes, a particular embedding store,
CRDT-vs-OT for collaboration) are implementation details to decide when this
phase is actually specified, not commitments made now.

## Explicitly deferred (not in this roadmap yet)

Per the Foundation phase's exclusions, these remain future work and are
**not** part of "the whole editor" as scoped here — see Phase 7 above for
the distilled shape of this work when it's eventually specified:
- AI-assisted editing features (the product's eventual differentiator, but a distinct phase requiring its own product spec).
- Authentication, cloud sync, multi-user collaboration.
- A real database/backend for `apps/api` (currently a scaffold only).

## Suggested build order

Phase 0 → 1 → 2 → 3 (playback needs both decode and render) → 5 (UI needs a
working preview loop to be testable) → 4 (audio can develop in parallel with
2/3 but needs UI to be user-testable) → 6 (export depends on render + audio
being stable). Phase 7 (cloud + AI) is a distinct, later product decision —
build it only once local editing is solid and there's a real infra/GPU
budget behind it.

## Next step

Tell me which phase to turn into a full implementation prompt (same format
as the Foundation one — data model, required APIs, non-negotiable rules,
required tests, CI gates) and I'll write that phase's document next. Phase 1
(media decoding) is the natural next one, since Phases 2–6 all depend on it.
