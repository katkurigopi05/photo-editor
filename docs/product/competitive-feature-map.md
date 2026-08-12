# Competitive feature map

What ten reference editors offer, what Project Director has, and what that makes
the next steps. Written 2026-08-08 against the state of the repository at that
date.

## How to read this

This is a **gap map, not a wish list**. Everything here is either shipped,
deliberately declined, or queued with a size. A feature is only listed as a step
if it is compatible with the project's own constraints:

- local-first, on this machine, no accounts and no cloud service
  ([[Rules/Local Only]]);
- every project mutation through a validated command with an exact inverse
  ([[Concepts/Command Engine]]);
- deterministic render and export from a project version.

Features that exist only to serve a subscription, a marketplace, a rendering
farm or a collaboration server are recorded in **Declined** with the reason, so
nobody re-proposes them.

## The reference set

**Video** — Adobe Premiere Pro, DaVinci Resolve, Apple Final Cut Pro, CapCut,
Kdenlive.
**Photo** — Adobe Photoshop, Adobe Lightroom, Affinity Photo, GIMP, Capture One.

Chosen for coverage rather than market share: two subscription suites, one
free/open-source pair, one consumer/social editor, one perpetual-licence
challenger, one raw-first cataloguer.

## Where the project stands today

Shipped, verified by tests against the running app:

| Area | What exists |
| --- | --- |
| Editing model | Command engine with exact inverses, undo/redo, byte-exact replay, canonical JSON |
| Timeline | Multi-track, drag, snap, split, trim handles, ripple trim/delete, multi-select, per-clip speed 0.25–4× |
| Effects | 39 effect types — tone, colour grading, HSL mixer, colour wheels, presence, noise reduction, artistic passes, text, background removal |
| Masks | Linear/radial gradients, brush strokes, luminance and colour range, add/subtract/intersect, any effect maskable |
| Animation | Keyframes on position, scale, rotation, opacity, five easings, motion presets |
| Transitions | Crossfade, dip, slide, with per-clip in/out |
| Audio | Per-clip gain and pan, fades, equal-power crossfades, EQ, compressor, live monitoring, mixdown into export |
| Media | Import with streamed checksum, ratings, keywords, search, filters, saved views, browser in/out ranges |
| Markers | Note, chapter and to-do markers riding the clip |
| Raster | Brush, eraser, clone, lasso, magic wand, sharpen, smart fill, crop, transform, AI background removal (local U²-Net) |
| Export | H.264/MP4 to 4K, custom size and frame rate, bitrate, audio codec/bitrate, streaming to disk, GIF, PNG |
| Interfaces | Web app and an MCP server exposing every public command |

## Gap map

Legend: **✓** shipped · **◐** partial · **✗** missing · **⊘** declined.

### 1. Timeline and editing model

| Feature | Ref | Us | Note |
| --- | --- | --- | --- |
| Multi-track timeline | all | ✓ | |
| Ripple / roll / slip / slide trims | Premiere, Resolve, FCP | ◐ | ripple only; roll, slip and slide missing |
| Magnetic timeline, connected clips | FCP | ✗ | an architecture, not a feature — see step M1 |
| Compound clips / nested sequences | all pro | ✗ | step T3 |
| Multicam editing | Premiere, Resolve, FCP | ✗ | needs sync + angle switching; step T7 |
| Roles / lanes / track groups | FCP, Premiere | ✗ | step T4 |
| Three-point editing, insert/overwrite | all pro | ✓ | append, insert and overwrite from the bin; step T1 |
| J/K/L and keyboard-first trimming | all pro | ✗ | step T2 |
| Snapping | all | ✓ | |
| Markers | all | ✓ | timeline-level markers still missing |
| Adjustment layers | Premiere, Resolve | ✓ | see step L1 |
| Auto-save / project recovery | all | ✗ | step P1, and the highest-value item on this page |
| Multiple sequences per project | all pro | ◐ | schema allows it; the UI drives one |

### 2. Colour and image

| Feature | Ref | Us | Note |
| --- | --- | --- | --- |
| Primary correction (exposure, contrast, white balance) | all | ✓ | |
| Curves (RGB and per-channel) | all | ✓ | monotone-cubic control points, composite and per channel — step C1 |
| Colour wheels / three-way grading | Resolve, FCP, Premiere | ✓ | |
| HSL / colour mixer | Lightroom, Resolve | ✓ | |
| Scopes: waveform, vectorscope, histogram | Resolve, Premiere, Capture One | ✓ | all three, off by default |
| LUT import and export | Resolve, Premiere | ✗ | step C3 |
| Colour management, log/HDR handling | Resolve, Capture One | ✗ | step C6, large |
| Raw photo development | Lightroom, Capture One, Affinity | ✗ | exists in the Python track only; step C4 |
| Lens correction, chromatic aberration | Lightroom, Capture One | ✗ | needs a profile database; step C5 |
| Perspective / keystone correction | Photoshop, Lightroom | ✗ | step C5 |
| Match colour between shots | Resolve, Premiere | ✗ | step C7 |

### 3. Compositing and layers

| Feature | Ref | Us | Note |
| --- | --- | --- | --- |
| Layers with blend modes | Photoshop, Affinity, GIMP | ✓ | all sixteen W3C modes, per clip |
| Layer groups, clipping masks | Photoshop, Affinity | ✗ | step L2 |
| Non-destructive adjustment layers | Photoshop, Affinity, Capture One | ✓ | a clip whose effects apply to everything beneath — step L1 |
| Masks with feather and composition | all | ✓ | |
| AI subject / sky selection | Photoshop, Lightroom | ◐ | U²-Net background removal ships; masks cannot yet reference it — step L3 |
| Text with typography controls | all | ◐ | burned-in captions only: no font choice, tracking or leading — step L4 |
| Shapes and vector paths | Photoshop, Affinity, Canva-likes | ◐ | seven preset shapes, no editable paths |
| Pen tool / bézier paths | Photoshop, Affinity, GIMP | ✗ | step L5 |
| Content-aware fill / healing | Photoshop, Affinity | ◐ | diffusion smart-fill ships; no patch or healing brush — step L6 |

### 4. Motion and effects

| Feature | Ref | Us | Note |
| --- | --- | --- | --- |
| Keyframed transforms | all | ✓ | |
| Bézier keyframe interpolation | all pro | ◐ | five named easings; no editable curve — step A1 |
| Motion tracking | Resolve, Premiere | ✗ | step A2 |
| Stabilisation | Resolve, Premiere, FCP | ✗ | step A3 |
| Speed ramps (keyframed speed) | all pro | ✓ | stepped rational segments; smooth curves deferred — step A4 |
| Optical-flow retiming | Resolve, Premiere, FCP | ✗ | step A5 |
| Titles and lower thirds as templates | all | ✗ | step A6 |
| Green screen / chroma key | all pro | ◐ | colour-key background removal exists; no spill suppression or matte controls — step A7 |

### 5. Audio

| Feature | Ref | Us | Note |
| --- | --- | --- | --- |
| Per-clip gain, pan, fades | all | ✓ | |
| EQ and compression | all pro | ✓ | |
| Waveform display | all | ✓ | |
| Audio meters | all | ✓ | peak + RMS per channel, latching clip light |
| Noise reduction / de-hum | Resolve, Premiere | ✗ | step S2 |
| Ducking, sidechain | Resolve, Premiere, CapCut | ✗ | step S3 |
| Multi-band / mastering chain | Resolve | ✗ | low priority |
| Voice isolation | Resolve, CapCut | ✗ | needs a local model; step S4 |
| Audio-only scrubbing | all pro | ✗ | small; step S5 |

### 6. Media management

| Feature | Ref | Us | Note |
| --- | --- | --- | --- |
| Ratings, keywords, search, saved views | FCP, Lightroom, Capture One | ✓ | |
| Keyword ranges (part of a clip) | FCP | ✓ | tagged from the range editor; step M2 |
| Persistent catalogue across projects | Lightroom, Capture One | ✗ | step M3 |
| Proxy / optimised media | all pro | ✓ | 540p proxies, built on import, exports read the original |
| Relink missing media | all pro | ✗ | checksums exist, the flow does not — step M5 |
| EXIF / metadata display | Lightroom, Capture One, Photoshop | ✗ | small; step M6 |
| Batch export / recipes | Lightroom, Capture One, Affinity | ◐ | exists in the Python track only — step M7 |

### 7. Output

| Feature | Ref | Us | Note |
| --- | --- | --- | --- |
| H.264 MP4 to 4K, custom rate and bitrate | all | ✓ | |
| Streaming export to disk | all | ✓ | |
| HEVC, ProRes, VP9, AV1 | all pro | ✗ | schema models them; the browser encoder does one — step O1 |
| Image sequence export | all pro | ✗ | step O2 |
| Chapter markers in the file | FCP, Premiere | ✗ | the marker kind exists — step O3, small |
| Subtitles and captions | Premiere, Resolve, CapCut | ✗ | step O4 |
| Render queue / background render | all pro | ✗ | step O5 |
| Project interchange (XML/AAF/EDL) | all pro | ✗ | step O6 |
| Social presets and aspect-ratio reframe | CapCut, Canva-likes | ✗ | step O7, cheap and popular |

### 8. Application

| Feature | Ref | Us | Note |
| --- | --- | --- | --- |
| Save / open a project file | all | ✗ | **the largest hole on this page** — step P1 |
| Auto-save and crash recovery | all | ✗ | step P1 |
| Desktop application | all | ✗ | Tauri shell, deferred by decision (cost) |
| Undo history panel | all | ✓ | one entry per gesture, click to travel — step P2 |
| Customisable shortcuts | all pro | ✗ | step P3 |
| Templates and presets | CapCut, Canva-likes, Lightroom | ◐ | Looks and motion presets ship; nothing is user-definable — step P4 |
| GPU-accelerated rendering | all pro | ✗ | canvas 2D throughout; step P5, large |

## Declined

| Feature | Reason |
| --- | --- |
| Cloud sync, shared libraries, review links | No server, no accounts ([[Rules/Local Only]]) |
| Collaboration and comments | Single machine, single user |
| Subscriptions, entitlement checks, marketplaces | No commercial layer |
| Generative fill / text-to-video / avatars | Creates new imagery rather than editing the user's own; a hosted model would break local-only, and a local diffusion model is a separate project |
| Telemetry and analytics | Prohibited |
| Stock libraries, sound-effect catalogues | Hosted content |

## Upcoming steps, in order

Ordered by value per unit of work, with dependencies respected. Sizes: **S** a
session, **M** a few sessions, **L** a phase.

### Now — the foundations everything else assumes

1. ~~**P1 · Save, open and auto-save a project**~~ — done. Save, Save as, Open,
   a recent-projects list, relink by checksum, and a 15-second crash snapshot.
   See `docs/phases/project-persistence.md`.
2. ~~**M4 · Proxy media**~~ — done. 540p proxies built on import, keyed by
   checksum, read while editing; exports read the original. See
   `docs/phases/proxy-media.md`.
3. ~~**S1 · Audio meters** and **C2 · Video scopes**~~ — done. Peak/RMS metering
   with a latching clip light, and histogram, waveform and vectorscope. See
   `docs/phases/meters-and-scopes.md`.

### Next — the editing model catches up

4. ~~**M2 · Keyword ranges**~~ — done. A persisted range object in source-local
   microseconds, add/update/remove commands and their MCP tools, tagging from
   inside the range editor, and chips that load a range back for the next add.
   Search and the keyword picker both reach range keywords. See
   `docs/phases/keyword-ranges.md`.
5. ~~**T1 · Three-point editing (insert / overwrite / append)**~~ — done. The
   browser range was the source half; `timeline.insert_clip` and
   `timeline.overwrite_clip` are the destination half, chosen from an "Add as"
   control in the timeline toolbar. Insert ripples its own track only. See
   `docs/phases/three-point-editing.md`.
6. ~~**A4 · Speed ramps**~~ — done. `timeline.set_clip_speed_ramp` carries a
   list of constant rational segments anchored in source time; stepped rather
   than interpolated, so every source instant stays exactly computable. Smooth
   curves are deferred with the reason recorded. See
   `docs/phases/speed-ramps.md`.
7. ~~**L1 · Blend modes and adjustment layers**~~ — done. Blend modes shipped
   earlier (see `docs/phases/blend-modes.md`); adjustment layers are the other
   half, modelled as an asset kind so a clip carrying one stays an ordinary
   clip. A `reorder_tracks` command is the remaining gap — "＋ Adjustment" makes
   room by moving clips down. See `docs/phases/adjustment-layers.md`.
8. ~~**C1 · Control-point curves**~~ — done. Monotone cubic (Fritsch–Carlson)
   so a curve never overshoots between its points, on the composite and on each
   channel, with a drag-to-shape editor. See `docs/phases/curves.md`.
9. ~~**P2 · Navigable history panel**~~ — done. One entry per gesture rather
   than per operation, named after the action, with the redo branch drawn and
   clickable. Clicking steps Undo/Redo rather than jumping, so it cannot
   disagree with the buttons. See `docs/phases/history-panel.md`.

### Later — bigger bets

10. **T3 · Compound clips** — **L**. Needs nesting in the schema and the render
    path.
11. **A2 · Motion tracking** and **A3 · Stabilisation** — **L** each. Both need
    real optical-flow work; both are the sort of thing a native pipeline does
    far better than canvas 2D.
12. ~~**O1 · More codecs**~~ — done. VP9 and AV1 into WebM beside H.264 into
    MP4, with the set offered probed from the browser at the chosen size rather
    than assumed. See `docs/phases/codecs.md`.
13. **C4 · Raw development** — **L**. Exists in the Python track; bringing it to
    the web stack means a decoder and a colour pipeline.
14. **M1 · Magnetic timeline** — **L**, and a decision before a task: it changes
    what a track *is*, and the overlap rules in the reducer with it.
15. **P5 · GPU rendering** — **L**. There is no GPU code at all: no WebGL, no
    WebGPU, and no `crates/render-engine` — that crate is in the roadmap's
    planned layout but was never created. What the GPU does today is only what
    the browser gives for free (canvas compositing, `ctx.filter`, blend modes,
    and hardware H.264 via WebCodecs). The ten `GRADING_TYPES` effects, mask
    rasterisation and the artistic passes are all `getImageData` → JS loop →
    `putImageData` on one thread. The win is WebGL2/WebGPU shaders for that
    pipeline inside `apps/web`, not the native crate: native `media-core` work
    was already deferred precisely because it had no effect on the running app.

## What this map says about the project

Three honest conclusions:

- **The engine was ahead of the application, and the application has caught up
  on the basics.** Effects, masks, grading, audio and the command model compared
  respectably with paid tools while there was no way to save a project. Saving,
  reopening and relinking closed that; the interesting items on this list are
  worth having now.
- **The two "you cannot see what you are doing" gaps are closed.** Scopes and
  audio meters were both small and both changed how usable everything already
  built is — which is the pattern to keep looking for.
- **Large media is imported and now comfortable.** The checksum ceiling went
  first, proxies second. What remains on that axis is the export audio mixdown,
  which still allocates one buffer for the whole timeline.
- **What is left divides cleanly.** Steps 4–9 are editing-model work the schema
  already accommodates; steps 10–15 are the ones that need new machinery
  (nesting, optical flow, a raw pipeline, the GPU crate that still has no
  consumer).
