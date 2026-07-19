# photo-editor

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
```

A "recipe" is the JSON produced by **Save Recipe** in the GUI (or
`Document.save_recipe`): a portable list of operations that can be replayed on
any image, folder, GIF, or video.

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```

The suite is headless (no display needed); GUI-only behavior isn't exercised.
