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

### Personal-editor enhancement direction (Remini reference)

Remini is a useful reference for making advanced enhancement approachable, not
for expanding Project Director into an avatar generator, advertising platform,
subscription service, or business API. Its strongest transferable pattern is a
one-click enhancement followed by Before/After comparison and optional finer
controls. As of August 2026, Remini presents unblur/sharpen, denoise, old-photo
restoration, 2x enlargement, color correction, face/background enhancement, and
video enhancement as separate capabilities:

- <https://remini.ai/>
- <https://remini.ai/unblur-sharpener>
- <https://remini.ai/denoiser>
- <https://remini.ai/photo-restorer>
- <https://remini.ai/image-enlarger>
- <https://remini.ai/face-enhancer>
- <https://remini.ai/video-enhancer>

For Project Director's personal, local-first editor, prioritize the following:

1. **Smart Restore MVP** — one command applies a reversible, inspectable effect
   stack with `General`, `Portrait`, and `Old Photo` presets. Start with local
   denoising plus the existing White Balance, Levels, Vibrance, and Sharpen
   operations. Expose one overall Strength control and retain the existing
   press-and-hold Before/After comparison. Applying or replacing a preset must
   remain one Undo step and must never modify the imported original.
2. **High-quality 2x upscale at export** — offer upscaling as an export option
   so large generated pixels do not need to live in project state. The export
   plan records the requested scale and implementation version; output is
   generated from a frozen project version. Begin with a deterministic local
   resampler, then allow a local super-resolution model behind the same stable
   intent when licensing, memory use, and quality are verified.
3. **Old-photo repair** — add dust/scratch reduction, faded-color recovery, and
   localized repair as explicit operations. Prefer an honest repair mask and
   user-adjustable strength over silently reconstructing uncertain detail.
4. **Conservative face enhancement** — keep face-detail recovery separate from
   beautification. It must be opt-in, strength-adjustable, locally previewed,
   and evaluated for identity drift. Any model that invents plausible detail
   must label the result as reconstructed rather than recovered.
5. **Video enhancement last** — temporal denoise, restoration, and upscale are
   valuable but require shot-aware processing and temporal-consistency tests.
   Do not ship a frame-by-frame photo enhancer as video enhancement if it
   flickers, changes identity between frames, or produces unstable edges.

#### Required libraries and tools

Do not add a new dependency merely because it appears in this roadmap. Add it
with the feature that uses it, pin it through the appropriate lockfile, record
its license and model provenance, and prove that the existing implementation
cannot meet the requirement more simply. The preferred stack is:

| Capability | Library or tool | Status and purpose |
| --- | --- | --- |
| Effect composition | `@director/raster-tools`, project-schema effects, and editor-state commands | **Already present; required for the MVP.** Extend the existing deterministic pixel operations with a denoise primitive, then materialize Smart Restore as one validated, reversible effect-stack command. No new AI runtime is required for the first version. |
| Browser model inference | [`onnxruntime-web`](https://onnxruntime.ai/docs/get-started/with-javascript/web.html) | **Already present; required for model-backed features.** Reuse the same local runtime as AI background removal. Prefer WebGPU for compute-heavy models with a WASM fallback, run work off the UI thread, and explicitly release tensors/sessions. Keep the JavaScript bundle and WASM binaries from the same package build. |
| Browser processing isolation | Web Workers, `OffscreenCanvas`, transferable `ArrayBuffer`s, and WebCrypto `subtle.digest` | **Browser platform APIs; required.** Enhancement must not freeze the editor. Transfer pixels to a worker where supported, tile memory-heavy work, report progress/cancellation outside project state, and SHA-256-verify every downloaded or bundled model before inference. |
| Classical denoise and masked repair | [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html), preferably a reproducible custom WASM build from official OpenCV source | **Evaluate before adding.** Useful for non-local-means denoising, filtering, color conversion, resizing, and mask-driven inpainting. Compile only the modules/functions actually used, with WASM/SIMD and optional threads; first confirm the needed APIs are exposed by the JavaScript build. OpenCV 4.x is Apache-2.0. |
| 2x learned upscale | [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN), beginning with `RealESRGAN_x2plus` | **Candidate, not a browser package dependency.** Convert and validate an approved model to ONNX, then execute tiled inference through `onnxruntime-web`; do not ship the Python/PyTorch runtime in the app. The official implementation supports tiled inference and is BSD-3-Clause, but redistribution rights for each exact weight/conversion must still be recorded. |
| Face-detail restoration | [GFPGAN](https://github.com/TencentARC/GFPGAN) plus a face detector/alignment model exported to ONNX | **Research-gated candidate.** GFPGAN is Apache-2.0, but its own documentation notes that restoration can change identity. It may be used only after identity-drift evaluation, with an opt-in strength control and separate compositing over the untouched source. Do not make it part of Smart Restore's default path. |
| Model conversion and inspection | Python 3, PyTorch, `onnx`, `onnxruntime`, and [Netron](https://github.com/lutzroeder/netron) | **Developer-only toolchain.** Use outside the shipped application to export models, simplify/static-shape them where safe, inspect operators, compare ONNX output against the source framework, and generate golden fixtures. Add exact versions to `requirements-ai.txt` only when the first converted model is adopted. |
| Video decode/encode | WebCodecs in the web app; FFmpeg for native/offline validation and fixture inspection | **WebCodecs already required for MP4 export; FFmpeg is a future developer/native tool.** Video enhancement must decode, process, and encode through a bounded frame queue. FFmpeg does not belong in the browser bundle. |
| Verification | Vitest, Playwright, canonical JSON tests, pixel fixtures, PSNR/SSIM, and temporal-difference/flicker metrics | **Existing test runners; new quality fixtures required.** Tests must cover command rejection immutability, undo/redo/replay, Before/After parity, alpha preservation, tile seams, cancellation, memory bounds, deterministic classical output, model checksum failure, and real exported-file decode. |

Before accepting any new model, create a model card in the repository recording:

- source URL, upstream commit/release, task, architecture, and exact filename;
- code license, weight license, training-data disclosure if available, and
  required attribution/NOTICE text;
- SHA-256, byte size, ONNX opset, input/output tensor contract, color range,
  normalization, supported execution providers, and tile overlap;
- peak memory and median/p95 runtime on the supported reference browsers;
- quality results on portraits, landscapes, old photos, text, transparency,
  very small inputs, already-sharp inputs, and adversarial failure cases; and
- known hallucination, identity, color-shift, seam, and temporal-consistency
  risks, plus the UI label used to disclose reconstructed content.

For the first Smart Restore milestone, the only approved runtime additions are
none: use the current project packages and browser APIs. OpenCV.js becomes a
dependency only if its measured quality/performance beats a focused
`raster-tools` implementation enough to justify its WASM cost. Real-ESRGAN and
GFPGAN require separate evaluation milestones and must not be silently pulled
in as transitive dependencies of the MVP.

The default product boundary remains deliberately personal: no accounts,
subscriptions, advertisements, weekly quotas, collaboration, or business API.
Media should stay on-device by default. If a future optional provider is added,
the UI must disclose the upload before it happens, make retention behavior
explicit, and route it through the Model Gateway rather than embedding provider
details in commands or project state.

Do not carry forward Remini's generative AI Photos/avatar workflow. It creates
new identity imagery rather than improving media the user is editing, so it is
outside Project Director's focused personal-editor purpose.

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
