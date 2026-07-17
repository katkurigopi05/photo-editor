# Pro Development Roadmap

This document captures competitive research on established photo-editing applications
and lays out a phased roadmap for evolving this repository's MVP
(`photo_editor.py`) into a professional-grade photo editor.

## 1. Current State (MVP)

`photo_editor.py` is a single-file Tkinter + Pillow application. It provides:

- Open / Save (`SimpleImageEditor.load_image`, `save_image`)
- A **linear, destructive** undo stack capped at 10 states (`_save_current_state`, `undo`)
- Filters: Grayscale, Sepia, Blur
- Adjustments: Rotate 90°, Flip Horizontal/Vertical, Brightness Up/Down, fixed 800×600 Resize
- A single preview `Label` widget with no zoom/pan, cropping, or selection tools

There are no layers, no masks, no non-destructive editing, no RAW support, and no
plugin or scripting surface. The GUI and the image-processing logic are tightly
coupled in `AppGUI`/`SimpleImageEditor`.

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

## 3. Gap Analysis

Relative to the apps above, the current MVP is missing:

- **Non-destructive editing** — today, `undo()` just pops pixel snapshots off a
  capped list; there's no editable "recipe" of adjustments.
- **Layers & masks** — no compositing, no selective/local adjustments (Snapseed's
  brush mask, Photoshop/Affinity layer masks).
- **RAW support** — `load_image` only handles formats Pillow decodes directly
  (no `.CR2`/`.NEF`/`.ARW` etc.).
- **Core tools** — no crop, no levels/curves, no selection tools.
- **AI-assisted tools** — no background/object removal, generative fill, or upscaling.
- **Extensibility** — filters are hardcoded `if/elif` branches in
  `apply_filter`; no plugin or scripting interface (contrast with GIMP's
  Script-Fu/Python-Fu or Photoshop's plugin API).
- **Performance/UX at scale** — all processing runs synchronously on the UI
  thread; a large image or slow filter will freeze the Tkinter mainloop.
- **Batch processing** — every competitor above supports operating on more than
  one image at a time; the MVP only ever holds one.

## 4. Proposed "Pro" Feature Roadmap

| Phase | Goal | Representative Features |
|---|---|---|
| **Phase 1 — Non-destructive core** | Replace the pixel-snapshot undo stack with an adjustment graph | Crop, Levels, Curves, Rotate/Flip as reorderable, editable, re-toggleable operations over an immutable base image |
| **Phase 2 — Layers & masking** | Introduce compositing | Layer stack (image/adjustment layers), brush-based masks for local/selective edits (Snapseed-style) |
| **Phase 3 — RAW support** | Handle camera RAW formats | Integrate `rawpy`/`libraw` for `.CR2`/`.NEF`/`.ARW`/`.DNG` ingestion |
| **Phase 4 — Extensibility** | Let the tool grow like GIMP/Photoshop | Plugin/filter registry (entry-point based) so new filters/tools don't require editing the core class |
| **Phase 5 — AI-assisted tools** | Match Luminar Neo/Lightroom's generative tools | Optional integrations for background removal, object removal/generative fill, and upscaling (e.g. via an external model API or ONNX runtime), kept opt-in so the core app stays lightweight |
| **Phase 6 — Performance & batch** | Scale beyond a single small image on the UI thread | Move processing off the Tkinter mainloop (worker thread/process + progress feedback), add batch import/export across multiple files |

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

## 6. Sources

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
