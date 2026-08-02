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

The motion clip is only written when a full `ffmpeg` is available (H.264/mp4 if
the build has `libx264`, VP8/webm otherwise):

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
| `video/motion-1280x720-5s.*` | Video decode, seeking, frame-accurate export (generated only when ffmpeg is present) |

## Notes

- The audio file is stereo and deliberately asymmetric — the left channel
  carries the sweep, the right carries a half-frequency tone plus the clicks —
  so a channel swap or a collapsed mixdown is audible rather than subtle.
- `portrait-subject` is a drawn figure, not a photo. It is good enough to judge
  matte edges and haloing, but it is not a substitute for testing background
  removal on real photographs before shipping that feature.
