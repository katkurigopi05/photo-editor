# Test media

Sample assets for exercising the editor by hand or from tests.

## Licence

**CC0 1.0 — public domain dedication.** Everything in this directory is drawn
from scratch by [`scripts/make_test_media.py`](../scripts/make_test_media.py):
procedural gradients, shapes and noise, plus a synthesised audio tone. There
are no photographs, no stock assets, no third-party fonts, and nothing was
downloaded. Use, modify and redistribute them for any purpose, with or without
attribution.

## Regenerating

```bash
python3 scripts/make_test_media.py
```

Requires Pillow and NumPy. Output is deterministic — the noise is seeded, so a
rerun reproduces the same bytes and will not churn the diff.

The committed clip is H.264/mp4. The encoder is chosen by probing what the
installed ffmpeg actually ships (`libx264` first, `libvpx`/webm as a fallback),
and the clip is skipped entirely when neither is available:

```bash
brew install ffmpeg && python3 scripts/make_test_media.py
# or point at an existing binary:
FFMPEG=/path/to/ffmpeg python3 scripts/make_test_media.py
```

## What each file is for

| File | Exercises |
|---|---|
| `photos/gradient-landscape-1600x900.png` | Brightness, contrast, exposure, tint — wide flat colour shows banding first |
| `photos/colour-chart-1024x1024.png` | Saturation, grayscale, sepia, invert, duotone; the neutral ramp exposes clipping |
| `photos/portrait-subject-900x1200.png` | AI background removal — clean silhouette on a shaded (not flat) backdrop |
| `photos/detail-texture-1280x960.jpg` | JPEG decode path; blur and sharpen against real high-frequency detail |
| `photos/alpha-badge-512x512.png` | Alpha compositing, opacity, border, vignette over transparency |
| `photos/tiny-swatch-64x64.png` | Small-input edge case for scaling and export sizing |
| `animation/spinner-240x240.gif` | GIF import path. Note the app registers it as an *image*, not an animation — it is a frame source and a round-trip target for GIF mode, not a test of animated-GIF decoding |
| `audio/tone-sweep-5s.wav` | Waveform rendering, audio gain/pan, audio in export. Clicks land on each second boundary, so trim and sync are checkable by ear |
| `video/motion-1280x720-5s.mp4` | Video decode, seeking, frame-accurate export. H.264, 1280x720, 24fps, exactly 120 frames. The marker crosses the frame once per clip and the bottom ticks light one per second, so the displayed frame can be read off the picture — a preview that lags the playhead is visible rather than merely suspected |

## Format coverage

The alternate-format files exist so "does it open a .mov / .mp3 / .webp" can be
answered by importing one. All of the below were verified importing in a single
multi-select into Chromium: correct kind, correct duration, decoded preview.

| Format | Fixture | Imports as |
|---|---|---|
| PNG | `photos/*.png` | image |
| JPEG | `photos/*.jpg` | image |
| WebP | `photos/colour-chart-512x512.webp` | image |
| GIF | `animation/spinner-240x240.gif` | image (first frame) |
| MP4 / H.264 | `video/motion-1280x720-5s.mp4` | video |
| QuickTime | `video/motion-640x360-3s.mov` | video |
| WebM / VP9 | `video/motion-640x360-3s.webm` | video |
| MP3 | `audio/tone-sweep-5s.mp3` | audio |
| AAC in M4A | `audio/tone-sweep-5s.m4a` | audio |
| Opus in Ogg | `audio/tone-sweep-5s.ogg` | audio |
| FLAC | `audio/tone-sweep-5s.flac` | audio |
| WAV | `audio/tone-sweep-5s.wav` | audio |

No fixture is committed for AVIF, HEIC, MKV or AVI. The importer classifies
them by extension, but whether they decode depends entirely on the browser
build, and a fixture that fails on half of them is worse than none. Undecodable
files are reported by name and never reach the timeline.

## Notes

- The audio file is stereo and deliberately asymmetric — the left channel
  carries the sweep, the right carries a half-frequency tone plus the clicks —
  so a channel swap or a collapsed mixdown is audible rather than subtle.
- `portrait-subject` is a drawn figure, not a photo. It is good enough to judge
  matte edges and haloing, but it is not a substitute for testing background
  removal on real photographs before shipping that feature.
