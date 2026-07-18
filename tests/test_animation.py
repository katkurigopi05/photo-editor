"""Tests for animated-GIF frame editing (Phase A). Pillow-only."""
import json
import os
import sys

import pytest
from PIL import Image, ImageSequence

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import Grayscale, Resize, Brightness  # noqa: E402
from core.frames import apply_to_animation, render_frames  # noqa: E402


def _make_gif(path, n_frames=4, size=(40, 30), duration=120):
    frames = []
    for i in range(n_frames):
        im = Image.new("RGB", size, (i * 40 % 256, 100, 200))
        frames.append(im)
    frames[0].save(path, save_all=True, append_images=frames[1:],
                   duration=duration, loop=0, format="GIF")


@pytest.fixture
def gif(tmp_path):
    path = tmp_path / "in.gif"
    _make_gif(str(path))
    return str(path)


def test_render_frames_applies_ops_per_frame(gif):
    image = Image.open(gif)
    edited = list(render_frames(image, [Resize(20, 15)]))
    assert len(edited) == 4
    assert all(f.size == (20, 15) and f.mode == "RGB" for f in edited)


def test_apply_to_animation_preserves_frame_count(tmp_path, gif):
    out = tmp_path / "out.gif"
    count = apply_to_animation(gif, [Grayscale()], str(out))
    assert count == 4
    result = Image.open(out)
    assert getattr(result, "n_frames", 1) == 4
    assert result.format == "GIF"


def test_apply_to_animation_changes_size(tmp_path, gif):
    out = tmp_path / "out.gif"
    apply_to_animation(gif, [Resize(20, 15)], str(out))
    result = Image.open(out)
    assert result.size == (20, 15)
    # every frame resized
    for frame in ImageSequence.Iterator(result):
        assert frame.size == (20, 15)


def test_apply_to_animation_from_recipe(tmp_path, gif):
    recipe = tmp_path / "r.json"
    recipe.write_text(json.dumps({
        "version": 1,
        "operations": [Grayscale().to_dict(), Brightness(1.2).to_dict()],
    }))
    from core.document import operations_from_recipe
    out = tmp_path / "out.gif"
    count = apply_to_animation(gif, operations_from_recipe(str(recipe)), str(out))
    assert count == 4


def test_animate_cli(tmp_path, gif):
    import animate
    recipe = tmp_path / "r.json"
    recipe.write_text(json.dumps({"version": 1, "operations": [Grayscale().to_dict()]}))
    out = tmp_path / "out.gif"
    rc = animate.main([str(recipe), gif, str(out)])
    assert rc == 0
    assert Image.open(out).format == "GIF"
