# Pro Development Roadmap

This document captures competitive research on established photo-editing
applications and tracks this repository's evolution from a single-file MVP into
a professional-grade, non-destructive editor for **photos, GIFs and video** —
built around one core idea: **one recipe, every medium.** A single serializable
list of operations is authored once and replayed on a photo, a folder, a GIF,
or a video. A public-facing summary of this lives in
[`web/index.html`](web/index.html) (a "ships today vs coming soon" landing page).

## 1. Where it started, where it is now

**Where it started (the MVP).** `photo_editor.py` was a single-file Tkinter +
Pillow app with a linear, destructive undo stack capped at 10 states, three
filters (Grayscale, Sepia, Blur), a few fixed adjustments, and no layers, masks,
non-destructive editing, RAW support, or plugin surface — the GUI and image
logic tightly coupled in one class.

**Where it is now.** The image logic is a GUI-agnostic `core/` engine: 35
serializable `Operation`s, a `Document` with pointer-based undo/redo and JSON
recipes, masking, plugins, and a media dispatch layer. Optional modules add
OpenCV, AI, RAW and video capabilities behind lazy imports. Everything is
reachable from one entry point (`app.py`) and a media-aware GUI. See the status
summary below.

## 1b. Status — Ships today vs Coming soon

**Ships today**

- Non-destructive editing: editable operation list, pointer-based undo/redo, JSON recipes (`core/document.py`)
- 35 editing operations across light/tone, color, detail, effects, geometry (`core/operations.py`)
- Per-channel (R/G/B) Curves and Levels for color grading (`Curves`/`Levels` `channel=` param)
- Local/selective edits via `MaskedOperation`
- Batch processing across a folder (`batch_export.py`)
- Animated GIF editing and building from stills (`core/frames.py`, `core/builder.py`)
- Video editing frame-by-frame with audio preserved (`video_tools/`, optional)
- Drop-in plugins (`core/plugins.py`, `plugins/`)
- OpenCV operations — CLAHE, denoise, bilateral, unsharp, inpaint object removal (`cv_tools/`, optional)
- AI operations — background removal, auto-crop (`ai_tools/`, optional)
- RAW loading (`rawpy`, optional)
- Unified CLI + media-aware GUI (`app.py`, `photo_editor.py`, `core/media.py`)
- 95 headless tests; SessionStart hook installs deps in web sessions

**Coming soon** (next on the roadmap, not yet shipped)

- Interactive Curves widget (drag control points on a live graph)
- Brush-mask UI for selective/local edits (compositing path already exists)
- AI generative fill & outpainting; AI upscaling
- In-browser web editor
- Video timeline & scrubbing in the GUI
- GPU-accelerated real-time preview

## 2. Competitive Research

| App | Type | Standout Features | Editing Model | Notable 2026 Developments |
|---|---|---|---|---|
| **Adobe Photoshop** | Desktop, paid (subscription) | Deep compositing, heavy retouching, layers, masks, generative fill, extensive plugin ecosystem | Non-destructive (adjustment layers, smart objects) | Still the compositing/graphic-design benchmark despite share loss to Affinity |
| **Adobe Lightroom** | Desktop/mobile/cloud, paid | Library management (keywords, ratings, color coding), AI object removal, AI-assisted culling of blurry/out-of-focus shots | Fully non-destructive (edits as metadata/"recipe", never touches original pixels) | Assisted culling tool added to speed up triage of large shoots |
| **Affinity Photo** | Desktop, **free** (Canva, late 2025) | Photoshop-class layers, masking, retouching, native RAW handling | Non-destructive | Folded into a unified Canva app alongside Designer/Publisher; now the default free pick over GIMP |
| **GIMP** | Desktop, free/open-source | Broad filter/plugin ecosystem, scripting (Script-Fu/Python-Fu) | Mostly destructive (no true adjustment layers), no native RAW | GIMP 3.0 (March 2025) improved workflow/usability, still trails on non-destructive editing |
| **Photopea** | Web, free/freemium | Runs in-browser, opens PSD/XCF/Sketch, layers + masks, imports Lightroom presets, no install | Non-destructive within a session | Premium tier adds AI tools, more history states, no ads |
| **Snapseed** | Mobile, free | Fast, intuitive; brush-based "mask" tool for selective/local correction | Non-destructive edit stack ("Stacks") | Remains the reference for simple, gesture-driven local adjustments |
| **Luminar Neo** | Desktop, paid | 24+ AI tools, layer-based compositing, GenErase (AI object removal/fill), GenExpand (AI outpainting) | Non-destructive, layer-based | Continues to push generative AI as a first-class editing tool, not an add-on |
| **Pixlr** | Web/mobile, freemium | Multiple editing modes: one-click auto-enhance up to full layered editor; social-media-sized exports | Mixed (simple mode destructive, advanced mode layered) | Optimized presets for Instagram/TikTok-style vertical content |
| **DaVinci Resolve — Photo page** | Desktop, free | Professional-grade RAW/color tools shared with Resolve's video color pipeline | Non-destructive, node-based | Photo page left beta in Resolve 21 (June 2026), a new free non-destructive competitor |

**Common pattern across every serious competitor:** non-destructive editing (edits
stored as instructions/metadata over an unmodified base image), a layer or node
model, native RAW support, and — increasingly — AI-assisted local tools
(object/background removal, generative fill/expand).

## 2b. Editing Toolset Research → Implemented Operations

Surveying the per-slider toolsets of Lightroom, Snapseed, Pixlr, GIMP and
Photoshop, the common "adjustment" vocabulary — and how much of it now ships in
`core/operations.py` — is:

| Category | Tool (as seen in Lightroom/Snapseed/Pixlr) | Operation class |
|---|---|---|
| Light/tone | Brightness / Exposure | `Brightness` |
| Light/tone | Contrast | `Contrast` |
| Light/tone | Highlights (recover/brighten) | `Highlights` |
| Light/tone | Shadows (lift/deepen) | `Shadows` |
| Light/tone | Levels (black/white/gamma) | `Levels` |
| Light/tone | Curves (control-point tone curve) | `Curves` |
| Light/tone | Auto Contrast / Auto Levels | `AutoContrast` |
| Light/tone | Histogram equalize | `Equalize` |
| Color | Saturation | `Saturation` |
| Color | Vibrance (protects skin/vivid tones) | `Vibrance` |
| Color | Temperature (warm/cool) | `Temperature` |
| Color | Tint (green/magenta) | `Tint` |
| Color | Auto White Balance (gray-world) | `AutoWhiteBalance` |
| Detail | Sharpen | `Sharpen` |
| Detail | Blur | `GaussianBlur` |
| Effects | Vignette | `Vignette` |
| Effects | Posterize | `Posterize` |
| Effects | Solarize | `Solarize` |
| Effects | Grayscale / Sepia / Invert | `Grayscale` / `Sepia` / `Invert` (plugin) |
| Geometry | Crop | `Crop` |
| Geometry | Straighten / arbitrary rotate | `Rotate` |
| Geometry | Rotate 90° / Flip / Resize | `Rotate90` / `FlipHorizontal` / `FlipVertical` / `Resize` |

All are Pillow-only (no new core dependency), serializable into recipes, and can
be wrapped in `MaskedOperation` for local/selective application. Still on the
roadmap: a true interactive Curves widget, per-channel curves, and a brush-mask
UI (the compositing path already exists).

## 3. Gap Analysis (original MVP → now)

These were the gaps against the researched apps when this was still an MVP.
Most are now closed (✅); the checkmarks double as a record of what was built.

- ✅ **Non-destructive editing** — an editable operation list with pointer-based undo/redo and JSON recipes replaced the capped pixel-snapshot stack.
- 🔶 **Layers & masks** — `MaskedOperation` gives selective/local edits; a full layer stack and brush-mask UI are still coming soon.
- ✅ **RAW support** — `Document.open` decodes RAW via optional `rawpy`.
- ✅ **Core tools** — crop, levels, curves, and the full adjustment set shipped (interactive Curves/selection UI still to come).
- 🔶 **AI-assisted tools** — background removal and auto-crop shipped; generative fill and upscaling are on the roadmap.
- ✅ **Extensibility** — the `if/elif` chain became a registry with a drop-in plugin loader.
- ✅ **Performance/UX at scale** — rendering and export run off the Tkinter mainloop with a busy state.
- ✅ **Batch processing** — plus GIF, video, and build-from-stills, all driven by the same recipe.

## 4. Proposed "Pro" Feature Roadmap

| Phase | Goal | Representative Features | Status |
|---|---|---|---|
| **Phase 1 — Non-destructive core** | Replace the pixel-snapshot undo stack with an adjustment graph | Crop, Levels, Curves, Rotate/Flip as reorderable, editable, re-toggleable operations over an immutable base image | ✅ Done — `core/` package: serializable `Operation` classes + `Document` with pointer-based undo/redo and JSON recipes (Levels/Curves still TODO) |
| **Phase 2 — Layers & masking** | Introduce compositing | Layer stack (image/adjustment layers), brush-based masks for local/selective edits (Snapseed-style) | 🔶 Partial — `MaskedOperation` applies any op inside a feathered rect/ellipse region (core only; brush-mask UI and full layer stack still TODO) |
| **Phase 3 — RAW support** | Handle camera RAW formats | Integrate `rawpy`/`libraw` for `.CR2`/`.NEF`/`.ARW`/`.DNG` ingestion | ✅ Done — `Document.open` decodes RAW extensions via optional `rawpy` (`requirements-raw.txt`) |
| **Phase 4 — Extensibility** | Let the tool grow like GIMP/Photoshop | Plugin/filter registry (entry-point based) so new filters/tools don't require editing the core class | ✅ Done — `core/plugins.py` loads `Operation` subclasses from `plugins/` at startup; GUI builds their buttons dynamically (see `plugins/invert.py`) |
| **Phase 5 — AI-assisted tools** | Match Luminar Neo/Lightroom's generative tools | Optional integrations for background removal, object removal/generative fill, and upscaling (e.g. via an external model API or ONNX runtime), kept opt-in so the core app stays lightweight | 🔶 Partial — `ai_tools/operations.py` provides `RemoveBackground` and `AutoCrop` as registry operations; generative fill/upscaling still TODO |
| **Phase 6 — Performance & batch** | Scale beyond a single small image on the UI thread | Move processing off the Tkinter mainloop (worker thread/process + progress feedback), add batch import/export across multiple files | ✅ Done — GUI renders on a worker thread with a busy state; `batch_export.py` applies a saved recipe to a folder |

## 5. Suggested Architecture Changes

- **Split `SimpleImageEditor`** into:
  - a `Document`/`LayerStack` model holding an immutable base image plus an
    ordered list of adjustment/layer operations (each serializable, so a
    "recipe" can be saved/reopened — Lightroom's model), and
  - a stateless set of **operation** classes (`Crop`, `Brightness`,
    `GaussianBlur`, ...) that know how to render themselves onto a `PIL.Image`,
    replacing the `if/elif` chain in `apply_filter`.
- **Decouple the engine from Tkinter.** `AppGUI` should only call into the
  `Document`/operation API, never touch `PIL.Image` directly — this keeps the
  door open for a future web (e.g. Photopea-style) or Qt frontend reusing the
  same core.
- **Undo/redo** becomes operating on the operation list (add/remove/reorder an
  operation), not on full-image snapshots — cheaper in memory and matches how
  every non-destructive competitor above works.
- **Candidate libraries:** keep Pillow for I/O/basic ops; add `numpy` for
  pixel-level operations (masks, curves LUTs); add `rawpy` for RAW decoding;
  consider `PySide6`/`PyQt6` as a longer-term GUI replacement for Tkinter once
  layers/masks need real canvas compositing and better widgets than Tkinter
  offers.

## 6. AI Tools Design (Phase 5 Detail)

A prototype `ai_tools/` package has been scaffolded to make Phase 5 concrete.
It is deliberately **kept out of the core app's dependency graph**: nothing in
`photo_editor.py` imports it, and each function inside it defers its heavy
imports (`ultralytics`, `transformers`, `torch`) until called, raising a clear
`ImportError` pointing at `requirements-ai.txt` if they're missing. This keeps
the base editor lightweight (Pillow + Tkinter only) while letting AI features
be installed and enabled opt-in — matching how Phase 4's plugin architecture
is meant to work.

| Capability | Model / Library | Function | Powers |
|---|---|---|---|
| Object detection | YOLOv8n (`ultralytics`) | `ai_tools.detect_objects(image)` | "Smart select" (auto-select a subject for masking/local edits, à la Luminar Neo/Photoshop) and auto-crop suggestions |
| Background removal | `briaai/RMBG-1.4` via `transformers` `image-segmentation` pipeline | `ai_tools.remove_background(image)` | One-click background removal/isolation, a building block for compositing and for Luminar's GenErase-style masked edits |

**Why these models:** YOLOv8n is the smallest/fastest YOLO variant — good
enough for interactive bounding-box detection on CPU, which matters since the
core app has no GPU requirement today. `briaai/RMBG-1.4` is a segmentation
model distributed through the `transformers` `pipeline("image-segmentation")`
API, so background removal doesn't need a bespoke inference loop. Both are
swappable behind their function signatures (`weights=`, `model_name=`
parameters) as better/lighter models emerge.

**How this plugs into the architecture in section 5:** once the
`Document`/operation model exists, `detect_objects` and `remove_background`
become the implementation behind new operation classes (e.g.
`SmartSelectOperation`, `RemoveBackgroundOperation`) rather than being called
directly from the GUI — same pattern as the Pillow-based operations, just
backed by a model call instead of a `PIL.ImageFilter`.

**Performance note (ties to Phase 6):** background removal via a transformer
pipeline is noticeably heavier than YOLOv8n detection. Both should run on a
worker thread/process with progress feedback rather than blocking the
Tkinter mainloop, and GPU acceleration (`torch` CUDA/MPS) should be
auto-detected and used when available.

**Files added:**
- `ai_tools/__init__.py` — public API (`detect_objects`, `remove_background`, `Detection`)
- `ai_tools/detection.py` — YOLO wrapper
- `ai_tools/segmentation.py` — transformer background-removal wrapper
- `requirements-ai.txt` — optional dependencies, install with `pip install -r requirements-ai.txt`

## 6b. Additional Libraries — cv_tools (OpenCV + NumPy)

Pillow covers I/O and the common adjustments, but some professional tools are
awkward or slow in pure Pillow. Rather than replace Pillow, the operation model
lets us add other libraries behind the same `apply(image) -> image` contract.
Survey of candidates:

| Library | Adds over Pillow | Weight |
|---|---|---|
| **NumPy** | Fast vectorized pixel math; enables custom algorithms | Light |
| **OpenCV** (`opencv-python-headless`) | CLAHE, non-local-means denoise, bilateral filter, inpainting, warping | ~40 MB |
| **scikit-image** | Research-grade restoration/segmentation (pulls in scipy) | Heavier |
| **rawpy / pillow-heif / imageio** | More formats (RAW added; HEIC/AVIF, animated) | Small |

Implemented: an optional **`cv_tools/`** package (OpenCV + NumPy), following the
same opt-in pattern as `ai_tools` — classes register into the core registry at
import time, but `cv2`/`numpy` are imported lazily inside `apply()`, so the
package is safe to import without the deps and raises a clear
`requirements-cv.txt` hint if used without them.

| Operation | Backing call | Why not pure Pillow |
|---|---|---|
| `CLAHE` | `cv2.createCLAHE` on LAB L-channel | Adaptive *local* contrast; Pillow only has global equalize |
| `Denoise` | `cv2.fastNlMeansDenoisingColored` | Edge-preserving noise removal |
| `BilateralFilter` | `cv2.bilateralFilter` | Edge-preserving smoothing (skin, flattening) |
| `UnsharpMask` | NumPy `img + amount*(img - blur)` | Fine-grained sharpening control |
| `RemoveObject` | `cv2.inpaint` (Telea/NS) over a region mask | Classical, no-ML distraction removal |

`cv_tools` is installed with `pip install -r requirements-cv.txt`. The four
parameterized filters have GUI buttons; `RemoveObject` needs an interactive
region selection (future work) and is currently used via the API/recipes.

## 6c. Animation & Video (recipe reuse across frames)

The operation/recipe model isn't limited to still images — the same recipe can
be applied to every frame of an animation or video. Two phases:

- **Phase A — Animated GIF (Pillow-only, no FFmpeg).** `core/frames.py` renders
  each frame of an animated GIF/WebP through the operation list, preserving
  per-frame duration and loop count. `animate.py` is the CLI
  (`python animate.py recipe.json in.gif out.gif`). Frames are edited in RGB
  (per-frame transparency is flattened).
- **Phase B — Video (optional, MoviePy + FFmpeg).** `video_tools/` applies a
  recipe to every video frame via MoviePy v2's `image_transform`, preserving
  audio. `edit_video.py` is the CLI
  (`python edit_video.py recipe.json in.mp4 out.mp4 [--no-audio]`). MoviePy is
  imported lazily (safe to import without it; clear `requirements-video.txt`
  hint otherwise). Size-changing geometry ops (Crop/Resize/Rotate) are rejected
  for video in this first version — every frame must keep the clip's size.

Note on the library survey (MoviePy, PyAV, OpenCV, Pillow): MoviePy and PyAV are
video libraries. This project stays image-first; video is an opt-in extension
that reuses the existing recipe rather than a rewrite. MoviePy was chosen over
PyAV for Phase B because its high-level `image_transform` + audio handling fit
the "apply a recipe per frame" use case with the least code.

## 6d. One Unified Application

Every capability is reachable from a single entry point, `app.py`, so the
project reads as one application rather than a pile of scripts:

```
python app.py gui | image | batch | gif | video | build | list-ops
```

- The **GUI** (`photo_editor.py`) detects the media type on open (image / GIF /
  video), lets you edit the first frame as a live preview, and on **Export**
  re-applies the operation recipe to the whole media via `core/media.py`
  (`detect_media_type` / `first_frame` / `export_media`). It also has a "Build
  from Images" action (stills → GIF).
- The **CLI** (`app.py`) exposes the same operations for one image, a folder,
  a GIF, a video, or building an animation from stills, plus `list-ops` (which
  reports all 35 operations, optional ones included).

The unifying idea throughout: a single serializable **recipe** (list of
`Operation`s) is authored once and replayed on any medium — one still, a batch,
GIF frames, or video frames. `core/media.py` is the thin dispatch layer that
routes a recipe to the right renderer per media type, and it is headless-testable
(the GUI is a thin shell over it).

## 7. Sources

- [The best photo editing software in 2026 — Digital Camera World](https://www.digitalcameraworld.com/buying-guides/the-best-photo-editing-software)
- [Best Photo Editing Software 2026: A Pro Photographer's Picks — Finding the Universe](https://www.findingtheuniverse.com/best-photo-editing-software/)
- [Best photo editing software to use in 2026 — Amateur Photographer](https://amateurphotographer.com/software/best-photo-editing-software/)
- [Photoshop vs Lightroom in 2026 — SelectHub](https://www.selecthub.com/photo-editing-software/photoshop-vs-lightroom/)
- [10 Best Lightroom Alternatives in 2026 — Wondershare](https://videoconverter.wondershare.com/ai-image-tips/lightroom-free-alternative.html)
- [Snapseed Alternatives — Skylum](https://skylum.com/blog/snapseed-alternatives)
- [Luminar Neo Features — Skylum Product Tour](https://skylum.com/product-tour)
- [6 Best Photopea Alternatives — Mockup Generator](https://mockupgenerator.ai/blog/photopea-alternatives/)
- [Non-destructive editing and how it works — Life After Photoshop](https://lifeafterphotoshop.com/non-destructive-editing-and-how-it-works/)
- [Pillow (PIL Fork) Documentation](https://pillow.readthedocs.io/en/stable/handbook/overview.html)
- [Basic Image Adjustments in Lightroom — PHLEARN](https://phlearn.com/tutorial/30-days-lightroom-day-4/)
- [Light & Contrast, Lightroom Essentials — Adobe](https://lightroom.adobe.com/academy/editing/lightroom-essentials/light-contrast)
- [Photography Basics: Editing with Snapseed — Britton Perelman](http://bybrittonperelman.com/writing/2018/4/16/photography-basics-editing-with-snapseed)
- [Where Is Vibrance In Snapseed — Snapseed Online](https://snapseed-online.com/where-is-vibrance-in-snapseed/)
- [Pixlr Editor Adjustment menu (Levels, Curves, Posterize, Color balance) — Wikibooks](https://en.wikibooks.org/wiki/Pixlr_Editor/Menus/Adjustment)
- [OpenCV-Python Documentation (CLAHE, denoising, inpainting)](https://docs.opencv.org/4.x/d6/d00/tutorial_py_root.html)
- [NumPy Documentation](https://numpy.org/doc/stable/)
