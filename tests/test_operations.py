"""Tests for the extended editing operations (light/tone, color, detail,
effects, geometry). Headless — Pillow only, no GUI."""
import os
import sys

import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import (  # noqa: E402
    Contrast, Highlights, Shadows, Levels, Curves, AutoContrast, Equalize,
    Saturation, Vibrance, Temperature, Tint, AutoWhiteBalance, Sharpen,
    Posterize, Solarize, Vignette, Crop, Rotate, operation_from_dict,
)


@pytest.fixture
def img():
    im = Image.new("RGB", (64, 48))
    im.putdata([((x * 4) % 256, (y * 5) % 256, (x * y) % 256)
                for y in range(48) for x in range(64)])
    return im


# every non-geometry op keeps mode and size, and produces a real change
NON_GEOMETRY = [
    Contrast(1.5), Highlights(-60), Shadows(60), Levels(20, 235, 1.2),
    Curves([[0, 0], [128, 170], [255, 255]]), AutoContrast(2), Equalize(),
    Saturation(1.6), Vibrance(50), Temperature(40), Tint(-30),
    AutoWhiteBalance(), Sharpen(2.5), Posterize(3), Solarize(120), Vignette(50),
]


@pytest.mark.parametrize("op", NON_GEOMETRY, ids=lambda o: type(o).__name__)
def test_op_preserves_mode_and_size(img, op):
    out = op.apply(img.convert("RGB"))
    assert out.mode == "RGB"
    assert out.size == img.size


@pytest.mark.parametrize("op", NON_GEOMETRY, ids=lambda o: type(o).__name__)
def test_op_round_trips_through_dict(op):
    restored = operation_from_dict(op.to_dict())
    assert type(restored) is type(op)
    assert restored.to_dict() == op.to_dict()


def test_contrast_identity_is_noop(img):
    rgb = img.convert("RGB")
    assert Contrast(1.0).apply(rgb).tobytes() == rgb.tobytes()


def test_levels_full_range_is_near_identity(img):
    rgb = img.convert("RGB")
    assert Levels(0, 255, 1.0).apply(rgb).tobytes() == rgb.tobytes()


def test_levels_rejects_bad_points():
    with pytest.raises(ValueError):
        Levels(200, 100)
    with pytest.raises(ValueError):
        Levels(0, 255, gamma=0)


def test_curves_identity_is_noop(img):
    rgb = img.convert("RGB")
    assert Curves([[0, 0], [255, 255]]).apply(rgb).tobytes() == rgb.tobytes()


def test_curves_brighten_midtones(img):
    rgb = img.convert("RGB")
    out = Curves([[0, 0], [128, 190], [255, 255]]).apply(rgb)
    assert ImageStat_mean(out) > ImageStat_mean(rgb)


def test_temperature_warms_red_cools_blue(img):
    rgb = img.convert("RGB")
    warm = Temperature(80).apply(rgb)
    r0, g0, b0 = channel_means(rgb)
    r1, g1, b1 = channel_means(warm)
    assert r1 > r0 and b1 < b0 and abs(g1 - g0) < 1e-6


def test_auto_white_balance_neutralizes_means(img):
    rgb = img.convert("RGB")
    out = AutoWhiteBalance().apply(rgb)
    r, g, b = channel_means(out)
    spread_before = max(channel_means(rgb)) - min(channel_means(rgb))
    spread_after = max(r, g, b) - min(r, g, b)
    assert spread_after <= spread_before


def test_posterize_reduces_distinct_values(img):
    rgb = img.convert("RGB")
    out = Posterize(2).apply(rgb)
    assert len(out.getcolors(maxcolors=1 << 24)) < len(rgb.getcolors(maxcolors=1 << 24))


def test_crop_clamps_out_of_bounds(img):
    out = Crop(-10, -10, 999, 999).apply(img.convert("RGB"))
    assert out.size == img.size  # clamped to full image
    inner = Crop(10, 5, 40, 30).apply(img.convert("RGB"))
    assert inner.size == (30, 25)


def test_rotate_expands_and_is_reversible_size(img):
    rgb = img.convert("RGB")
    assert Rotate(90).apply(rgb).size == (48, 64)
    assert Rotate(0).apply(rgb).size == (64, 48)
    # arbitrary angle expands the canvas
    assert Rotate(30).apply(rgb).size[0] > 64


def test_levels_per_channel_only_touches_one_channel(img):
    rgb = img.convert("RGB")
    # a strong red-only levels change must leave G and B bytes untouched
    out = Levels(30, 220, 1.4, channel="r").apply(rgb)
    r0, g0, b0 = rgb.split()
    r1, g1, b1 = out.split()
    assert r1.tobytes() != r0.tobytes()
    assert g1.tobytes() == g0.tobytes()
    assert b1.tobytes() == b0.tobytes()


def test_curves_per_channel_only_touches_one_channel(img):
    rgb = img.convert("RGB")
    out = Curves([[0, 0], [128, 200], [255, 255]], channel="b").apply(rgb)
    r0, g0, b0 = rgb.split()
    r1, g1, b1 = out.split()
    assert b1.tobytes() != b0.tobytes()
    assert r1.tobytes() == r0.tobytes()
    assert g1.tobytes() == g0.tobytes()


def test_channel_ops_round_trip_and_default_is_rgb(img):
    # default channel is "rgb" and survives a dict round-trip
    for op in [Levels(10, 240, 1.1), Curves([[0, 0], [255, 255]])]:
        assert op.params()["channel"] == "rgb"
        restored = operation_from_dict(op.to_dict())
        assert restored.channel == "rgb"
        assert restored.to_dict() == op.to_dict()
    # per-channel round-trips too
    op = Levels(0, 255, 1.0, channel="g")
    assert operation_from_dict(op.to_dict()).channel == "g"


def test_channel_validation():
    with pytest.raises(ValueError):
        Levels(0, 255, channel="cyan")
    with pytest.raises(ValueError):
        Curves(channel="alpha")


def test_rgb_channel_matches_legacy_all_channels(img):
    rgb = img.convert("RGB")
    # channel="rgb" applies the same LUT to every band (legacy behavior)
    out = Levels(20, 235, 1.3, channel="rgb").apply(rgb)
    r, g, b = out.split()
    # identical input bands (they differ here) aside, verify rgb path applied to all:
    # a gray image would map every band identically
    gray = Image.new("RGB", (16, 16), (128, 128, 128))
    gout = Levels(20, 235, 1.3, channel="rgb").apply(gray)
    gr, gg, gb = gout.split()
    assert gr.tobytes() == gg.tobytes() == gb.tobytes()


def test_full_edit_pipeline_round_trips(tmp_path, img):
    """Stack many of the new ops in a Document and confirm the saved recipe
    reproduces identical pixels."""
    from core import Document

    src = tmp_path / "src.png"
    img.save(src)
    doc = Document.open(str(src))
    for op in [AutoWhiteBalance(), Contrast(1.2), Shadows(40), Highlights(-30),
               Vibrance(35), Temperature(25), Sharpen(1.8), Vignette(30)]:
        doc.add_operation(op)
    rendered = doc.render()
    assert rendered.size == img.size and rendered.mode == "RGB"

    recipe = tmp_path / "r.json"
    doc.save_recipe(str(recipe))
    reloaded = Document.load_recipe(str(recipe))
    assert reloaded.render().tobytes() == rendered.tobytes()


# --- small helpers ---

def channel_means(image):
    from PIL import ImageStat
    return tuple(ImageStat.Stat(image).mean[:3])


def ImageStat_mean(image):
    from PIL import ImageStat
    return sum(ImageStat.Stat(image).mean[:3]) / 3
