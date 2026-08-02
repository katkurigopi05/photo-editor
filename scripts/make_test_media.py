#!/usr/bin/env python3
"""Generate the test_media/ fixtures.

Every asset here is drawn from scratch by this script — no photographs, no
stock, no fonts beyond Pillow's own bitmap default — so the output carries no
third-party rights and can be dedicated to the public domain (CC0). Rerunning
the script reproduces the files byte-for-byte: all randomness is seeded.

Each fixture targets something specific in the editor (see test_media/README.md
for the mapping). Keep them small; they are committed.

Usage:
    python3 scripts/make_test_media.py

The motion clip is skipped unless a usable ffmpeg is found on PATH or via
$FFMPEG; the still fixtures need nothing beyond Pillow and NumPy.
"""

from __future__ import annotations

import math
import shutil
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / "test_media"
SEED = 20260802


def _new_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def _save_png(image: Image.Image, path: Path) -> None:
    image.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB")


def _linear_ramp(width: int, height: int, angle_deg: float) -> np.ndarray:
    """A 0..1 ramp across the frame at `angle_deg`, used as a blend factor."""
    ys, xs = np.mgrid[0:height, 0:width]
    radians = math.radians(angle_deg)
    projected = xs * math.cos(radians) + ys * math.sin(radians)
    projected -= projected.min()
    return projected / projected.max()


def gradient_landscape(path: Path) -> None:
    """Smooth two-tone gradient with a soft vignette.

    Wide, flat colour is where brightness/contrast/exposure changes show
    banding first, so this is the frame to judge those on.
    """
    width, height = 1600, 900
    ramp = _linear_ramp(width, height, 28.0)[..., None]
    warm = np.array([246, 138, 62], dtype=np.float64)
    cool = np.array([46, 118, 194], dtype=np.float64)
    rgb = warm * (1.0 - ramp) + cool * ramp

    # Vignette: fall off with distance from centre, normalised so the corners
    # land at 0.72 rather than black.
    ys, xs = np.mgrid[0:height, 0:width]
    dx = (xs - width / 2) / (width / 2)
    dy = (ys - height / 2) / (height / 2)
    falloff = np.clip(1.0 - 0.28 * (dx**2 + dy**2), 0.0, 1.0)[..., None]

    image = Image.fromarray((rgb * falloff).round().astype(np.uint8), "RGB")
    _save_png(image, path)


def colour_chart(path: Path) -> None:
    """Primaries, secondaries, skin-ish tones and a 12-step neutral ramp.

    Saturation, grayscale, invert, sepia and duotone all have an obvious
    correct answer on these patches, and the neutral ramp makes clipping at
    either end easy to spot.
    """
    size = 1024
    image = Image.new("RGB", (size, size), (24, 26, 32))
    draw = ImageDraw.Draw(image)

    patches = [
        (220, 40, 48), (240, 140, 36), (242, 206, 58), (74, 182, 84),
        (48, 158, 196), (58, 82, 186), (128, 62, 176), (214, 78, 148),
        (236, 200, 172), (198, 150, 118), (140, 96, 72), (86, 56, 42),
    ]
    cell = size // 4
    for index, colour in enumerate(patches):
        col, row = index % 4, index // 4
        draw.rectangle(
            [col * cell + 12, row * cell + 12,
             (col + 1) * cell - 12, (row + 1) * cell - 12],
            fill=colour,
        )

    # Neutral ramp across the bottom quarter.
    steps = 12
    strip_top = 3 * cell + 12
    for step in range(steps):
        level = round(255 * step / (steps - 1))
        draw.rectangle(
            [step * size // steps, strip_top,
             (step + 1) * size // steps, size - 12],
            fill=(level, level, level),
        )
    _save_png(image, path)


def portrait_subject(path: Path) -> None:
    """A simple figure on a flat, contrasting background.

    Background removal needs a subject with a clean silhouette to be judged
    against; the flat backdrop makes a bad matte obvious at the edges.
    """
    width, height = 900, 1200
    image = Image.new("RGB", (width, height), (198, 214, 226))
    draw = ImageDraw.Draw(image)

    # Backdrop falloff so the background is not perfectly uniform — a matte
    # that only works on flat colour is not worth much.
    ramp = _linear_ramp(width, height, 90.0)[..., None]
    base = np.asarray(image, dtype=np.float64)
    shaded = base * (0.88 + 0.12 * (1.0 - ramp))
    image = Image.fromarray(shaded.round().astype(np.uint8), "RGB")
    draw = ImageDraw.Draw(image)

    skin = (226, 178, 146)
    shirt = (58, 74, 108)
    hair = (58, 44, 40)

    draw.ellipse([300, 690, 600, 1200], fill=shirt)          # shoulders
    draw.rectangle([405, 600, 495, 730], fill=skin)          # neck
    draw.ellipse([330, 300, 570, 640], fill=skin)            # head
    draw.chord([330, 270, 570, 560], 180, 360, fill=hair)    # hair
    draw.ellipse([390, 430, 420, 455], fill=(52, 48, 60))    # eyes
    draw.ellipse([480, 430, 510, 455], fill=(52, 48, 60))
    draw.arc([420, 500, 480, 550], 20, 160, fill=(158, 98, 88), width=6)

    # Soften the silhouette a touch: a razor-sharp synthetic edge would make
    # every matte look perfect.
    image = image.filter(ImageFilter.GaussianBlur(0.6))
    _save_png(image, path)


def detail_texture(path: Path) -> None:
    """Multi-octave noise, saved as JPEG.

    Exercises the JPEG decode path, and gives blur/sharpen something with real
    high-frequency detail to act on.
    """
    width, height = 1280, 960
    rng = np.random.default_rng(SEED)
    field = np.zeros((height, width), dtype=np.float64)
    amplitude = 1.0
    for octave in range(5):
        cells = 2 ** (octave + 2)
        coarse = rng.random((cells, cells))
        layer = np.asarray(
            Image.fromarray((coarse * 255).astype(np.uint8)).resize(
                (width, height), Image.BICUBIC
            ),
            dtype=np.float64,
        ) / 255.0
        field += layer * amplitude
        amplitude *= 0.5
    field = (field - field.min()) / (field.max() - field.min())

    # Tint the noise through a stone-ish ramp rather than leaving it grey.
    low = np.array([64, 58, 52], dtype=np.float64)
    high = np.array([224, 216, 200], dtype=np.float64)
    rgb = low + (high - low) * field[..., None]
    image = Image.fromarray(rgb.round().astype(np.uint8), "RGB")
    image.save(path, "JPEG", quality=88, optimize=True)
    print(f"  {path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB")


def alpha_badge(path: Path) -> None:
    """A soft-edged shape on full transparency.

    Compositing, opacity and border effects all behave differently once real
    alpha is involved; a fixture without any hides those bugs.
    """
    size = 512
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse([56, 56, 456, 456], fill=(124, 92, 255, 255))
    draw.ellipse([116, 116, 396, 396], fill=(74, 210, 201, 235))
    draw.polygon(
        [(256, 150), (300, 236), (394, 250), (326, 316),
         (342, 410), (256, 366), (170, 410), (186, 316),
         (118, 250), (212, 236)],
        fill=(255, 255, 255, 240),
    )
    image = image.filter(ImageFilter.GaussianBlur(1.2))
    _save_png(image, path)


def tiny_swatch(path: Path) -> None:
    """A 64x64 asset — the small end of the scaling path."""
    size = 64
    ys, xs = np.mgrid[0:size, 0:size]
    rgb = np.stack(
        [
            (xs * 255 // (size - 1)).astype(np.uint8),
            (ys * 255 // (size - 1)).astype(np.uint8),
            np.full((size, size), 168, dtype=np.uint8),
        ],
        axis=-1,
    )
    _save_png(Image.fromarray(rgb, "RGB"), path)


def spinner_gif(path: Path) -> None:
    """A looping animated GIF: something to import, and a boomerang source."""
    size, frames = 240, 24
    images = []
    for frame in range(frames):
        image = Image.new("RGB", (size, size), (18, 20, 27))
        draw = ImageDraw.Draw(image)
        angle = 2 * math.pi * frame / frames
        for dot in range(8):
            theta = angle + dot * math.pi / 4
            x = size / 2 + math.cos(theta) * 78
            y = size / 2 + math.sin(theta) * 78
            radius = 6 + 10 * (1 - dot / 8)
            shade = round(70 + 185 * (1 - dot / 8))
            draw.ellipse(
                [x - radius, y - radius, x + radius, y + radius],
                fill=(shade, round(shade * 0.55) + 40, 255 - shade // 3),
            )
        images.append(image.quantize(colors=64))

    images[0].save(
        path,
        "GIF",
        save_all=True,
        append_images=images[1:],
        duration=1000 // 12,
        loop=0,
        optimize=True,
    )
    print(f"  {path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB")


def tone_sweep(path: Path, seconds: float = 5.0, rate: int = 48000) -> None:
    """Stereo sweep with a click on each second.

    The sweep gives the waveform renderer a shape that is obviously wrong if
    drawn at the wrong scale, and the clicks mark exact second boundaries for
    checking trim and sync.
    """
    total = int(seconds * rate)
    t = np.arange(total) / rate
    # Exponential 200Hz -> 2kHz sweep; linear sweeps sound wrong to the ear.
    freq = 200.0 * (2000.0 / 200.0) ** (t / seconds)
    phase = 2 * np.pi * np.cumsum(freq) / rate
    envelope = np.minimum(1.0, np.minimum(t * 8, (seconds - t) * 8))
    left = 0.34 * np.sin(phase) * envelope

    clicks = np.zeros(total)
    for second in range(1, int(seconds)):
        start = second * rate
        length = int(0.012 * rate)
        decay = np.exp(-np.arange(length) / (0.003 * rate))
        clicks[start:start + length] = 0.5 * decay
    right = 0.34 * np.sin(phase * 0.5) * envelope + clicks

    interleaved = np.empty(total * 2, dtype=np.float64)
    interleaved[0::2] = np.clip(left, -1.0, 1.0)
    interleaved[1::2] = np.clip(right, -1.0, 1.0)
    samples = (interleaved * 32767).astype(np.int16)

    with wave.open(str(path), "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(struct.pack(f"<{samples.size}h", *samples))
    print(f"  {path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB")


def _find_ffmpeg() -> str | None:
    """ffmpeg from $FFMPEG, else PATH. The env var covers the common case of a
    usable binary that is not installed system-wide."""
    import os

    explicit = os.environ.get("FFMPEG")
    if explicit and Path(explicit).exists():
        return explicit
    return shutil.which("ffmpeg")


def _encoder_args(ffmpeg: str) -> tuple[list[str], str] | None:
    """Pick an encoder the given ffmpeg actually ships with.

    Builds bundled with other tools are often cut down to one codec, so probe
    rather than assume. H.264/mp4 first (what the editor exports), VP8/webm as
    the fallback — every browser this app targets decodes both.
    """
    try:
        listed = subprocess.run(
            [ffmpeg, "-hide_banner", "-encoders"],
            capture_output=True, text=True, check=True,
        ).stdout
    except (subprocess.CalledProcessError, OSError):
        return None

    if "libx264" in listed:
        return (["-c:v", "libx264", "-preset", "slow", "-crf", "26",
                 "-pix_fmt", "yuv420p"], ".mp4")
    if "libvpx" in listed:
        return (["-c:v", "libvpx", "-b:v", "1M", "-crf", "32",
                 "-pix_fmt", "yuv420p"], ".webm")
    return None


def motion_clip(path: Path, seconds: int = 5, fps: int = 24) -> bool:
    """Panning bars plus a travelling marker, encoded to video.

    The container follows whatever encoder is available (see `_encoder_args`),
    so `path`'s suffix is replaced accordingly. Returns False (and writes
    nothing) when no usable ffmpeg is found; the still fixtures are the ones
    the tests actually depend on.
    """
    ffmpeg = _find_ffmpeg()
    if ffmpeg is None:
        return False
    chosen = _encoder_args(ffmpeg)
    if chosen is None:
        return False
    codec_args, suffix = chosen
    path = path.with_suffix(suffix)

    width, height = 1280, 720
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        for index in range(seconds * fps):
            progress = index / (seconds * fps)
            image = Image.new("RGB", (width, height), (16, 18, 24))
            draw = ImageDraw.Draw(image)
            # Diagonal bars sliding left: obvious tearing/judder if frames are
            # dropped or ordered wrongly.
            for bar in range(-2, 20):
                x = bar * 96 - progress * 96 * 2
                draw.polygon(
                    [(x, 0), (x + 48, 0), (x + 48 - 120, height),
                     (x - 120, height)],
                    fill=(38, 44, 62) if bar % 2 else (52, 60, 84),
                )
            # Marker sweeping left to right, one pass per clip.
            cx = 80 + progress * (width - 160)
            draw.ellipse([cx - 34, height / 2 - 34, cx + 34, height / 2 + 34],
                         fill=(255, 122, 42))
            # Second ticks along the bottom edge.
            for second in range(seconds + 1):
                tick_x = 80 + second * (width - 160) / seconds
                lit = progress * seconds >= second
                draw.rectangle(
                    [tick_x - 5, height - 60, tick_x + 5, height - 30],
                    fill=(255, 255, 255) if lit else (86, 94, 116),
                )
            image.save(tmp_path / f"frame_{index:04d}.png")

        subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-framerate", str(fps),
             "-i", str(tmp_path / "frame_%04d.png"),
             *codec_args, str(path)],
            check=True,
        )
    print(f"  {path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB")
    return True


def main() -> None:
    photos = _new_dir(MEDIA / "photos")
    animation = _new_dir(MEDIA / "animation")
    audio = _new_dir(MEDIA / "audio")

    print("photos")
    gradient_landscape(photos / "gradient-landscape-1600x900.png")
    colour_chart(photos / "colour-chart-1024x1024.png")
    portrait_subject(photos / "portrait-subject-900x1200.png")
    detail_texture(photos / "detail-texture-1280x960.jpg")
    alpha_badge(photos / "alpha-badge-512x512.png")
    tiny_swatch(photos / "tiny-swatch-64x64.png")

    print("animation")
    spinner_gif(animation / "spinner-240x240.gif")

    print("audio")
    tone_sweep(audio / "tone-sweep-5s.wav")

    print("video")
    # Written only when a real ffmpeg is around; see the README.
    if motion_clip(MEDIA / "video" / "motion-1280x720-5s.mp4"):
        pass
    else:
        print("  skipped: no usable ffmpeg (install ffmpeg, or set $FFMPEG)")


if __name__ == "__main__":
    main()
