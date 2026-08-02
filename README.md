# Project Director / photo-editor

This repository hosts **two parallel editor tracks** that share the same
non-destructive philosophy:

## Track 1 — Project Director (TypeScript + Rust monorepo)

An AI-native, non-destructive photo/video/audio editor with a shared
deterministic core for desktop and web: a validated, reversible, replayable
project-operation engine (pnpm + Cargo monorepo), a working browser editor in
`apps/web`, and phase cores for media decode, effects, playback, audio, UI, and
export.

- Contributor guide & rules: [AGENTS.md](AGENTS.md)
- Setup & validation gates: [docs/setup.md](docs/setup.md)
- Architecture & data model: [docs/architecture/](docs/architecture/)
- Build roadmap (later phases): [PROJECT_DIRECTOR_FULL_BUILD_ROADMAP.md](PROJECT_DIRECTOR_FULL_BUILD_ROADMAP.md)

```bash
pnpm install
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
pnpm --filter @director/web dev   # run the browser editor
```

## Track 2 — photo-editor (Python application)

A non-destructive photo (and GIF/video) editor in Python. What began as a small
Pillow + Tkinter MVP is now a single application with a shared, serializable
editing model — **35 editing operations** that apply equally to a single photo,
a folder of photos, every frame of an animated GIF, or every frame of a video.

See [`PRO_DEVELOPMENT.md`](PRO_DEVELOPMENT.md) for the research, architecture,
and roadmap behind it.

## Architecture at a glance

- **`core/`** — the editing engine (GUI-agnostic): serializable `Operation`
  classes, a `Document` with pointer-based undo/redo and JSON "recipes", plus
  frame/animation/media helpers.
- **`plugins/`** — drop-in `Operation` subclasses loaded at startup.
- **`cv_tools/`** — optional OpenCV + NumPy operations (CLAHE, denoise, unsharp,
  inpaint object removal).
- **`ai_tools/`** — optional AI operations (background removal, auto-crop).
- **`video_tools/`** — optional MoviePy/FFmpeg video processing.
- **`photo_editor.py`** — the Tkinter GUI (photos, GIFs, and video in one window).
- **`app.py`** — the unified command-line entry point.

## Install

```bash
pip install -r requirements.txt          # core (Pillow) — the GUI also needs Tkinter
pip install -r requirements-cv.txt        # optional: OpenCV/NumPy operations
pip install -r requirements-ai.txt        # optional: AI operations (torch/transformers/ultralytics)
pip install -r requirements-video.txt     # optional: video support (MoviePy/FFmpeg)
pip install -r requirements-raw.txt        # optional: camera RAW support (rawpy)
pip install -r requirements-dev.txt        # everything above needed for the test suite + pytest
```

## Use — one command for everything (`app.py`)

```bash
python app.py gui                                   # launch the graphical editor
python app.py list-ops                              # list all editing operations
python app.py image  look.json photo.jpg out.png    # apply a recipe to one image
python app.py batch  look.json in_dir/ out_dir/     # apply a recipe to a folder
python app.py gif    look.json in.gif  out.gif      # apply a recipe to every GIF frame
python app.py video  look.json in.mp4  out.mp4      # apply a recipe to every video frame
python app.py build  slideshow.gif a.jpg b.jpg c.jpg --duration 500   # stills -> GIF
python app.py build  clip.mp4 frames/*.png --fps 24 --recipe look.json # stills -> video
python app.py togif  clip.mp4 out.gif --start 3 --end 8 --fps 12       # video -> GIF
python app.py togif  clip.mp4 loop.gif --size 480 270 --boomerang      # ping-pong GIF
```

### Making GIFs

Three ways, all sharing the same recipe model:

- **From still images** — `app.py build out.gif a.jpg b.jpg …` (or the GUI's
  **Build from Images** button). `--duration` sets ms per frame.
- **From a video** — `app.py togif in.mp4 out.gif`, optionally clipping a
  segment with `--start`/`--end`, resampling with `--fps` (8–15 keeps files
  small), and scaling with `--size`.
- **From an open video in the GUI** — just export it with a `.gif` filename.

Add `--boomerang` to any of them to play forward then backward.

A "recipe" is the JSON produced by **Save Recipe** in the GUI (or
`Document.save_recipe`): a portable list of operations that can be replayed on
any image, folder, GIF, or video.

## Tests

Run the suite in an isolated virtual environment so the project's dependencies
don't touch your system Python:

```bash
python -m venv .venv           # create the environment
source .venv/bin/activate       # activate it (Windows: .venv\Scripts\activate)
pip install -r requirements-dev.txt   # install core + optional (OpenCV, MoviePy) + pytest
pytest                          # run the ~100 headless tests
deactivate                      # leave the environment when done
```

`.venv/` is git-ignored. The suite is headless (no display needed), so the
Tkinter GUI itself isn't exercised — its logic lives in `core/media.py`, which
is tested. Tests for optional modules (`cv_tools`, `video_tools`) skip
automatically if their dependencies aren't installed.
