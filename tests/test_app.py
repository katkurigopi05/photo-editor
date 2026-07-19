"""Tests for the unified app.py CLI entry point (headless subcommands)."""
import json
import os
import sys

import pytest
from PIL import Image, ImageSequence

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app  # noqa: E402
from core import Grayscale, Brightness  # noqa: E402


@pytest.fixture
def photo(tmp_path):
    path = tmp_path / "p.png"
    im = Image.new("RGB", (60, 40))
    im.putdata([((x * 4) % 256, (y * 6) % 256, (x + y) % 256)
                for y in range(40) for x in range(60)])
    im.save(path)
    return str(path)


@pytest.fixture
def photos(tmp_path):
    """Three visually distinct still images (a real slideshow, so the GIF
    writer doesn't dedupe identical frames)."""
    paths = []
    for i in range(3):
        p = tmp_path / f"f{i}.png"
        Image.new("RGB", (60, 40), (i * 80 % 256, 60, 200)).save(p)
        paths.append(str(p))
    return paths


@pytest.fixture
def recipe(tmp_path):
    path = tmp_path / "r.json"
    path.write_text(json.dumps({
        "version": 1,
        "operations": [Grayscale().to_dict(), Brightness(1.1).to_dict()],
    }))
    return str(path)


def test_image_subcommand(tmp_path, recipe, photo):
    out = tmp_path / "out.png"
    assert app.main(["image", recipe, photo, str(out)]) == 0
    assert Image.open(out).size == (60, 40)


def test_batch_subcommand(tmp_path, recipe, photo):
    in_dir, out_dir = tmp_path / "in", tmp_path / "out"
    in_dir.mkdir()
    for name in ("a.png", "b.png"):
        Image.open(photo).save(in_dir / name)
    assert app.main(["batch", recipe, str(in_dir), str(out_dir)]) == 0
    assert sorted(os.listdir(out_dir)) == ["a.png", "b.png"]


def test_build_gif_subcommand(tmp_path, photos):
    out = tmp_path / "slideshow.gif"
    assert app.main(["build", str(out), *photos, "--duration", "300"]) == 0
    result = Image.open(out)
    assert result.format == "GIF"
    assert getattr(result, "n_frames", 1) == 3


def test_build_gif_with_recipe_and_size(tmp_path, recipe, photos):
    out = tmp_path / "s.gif"
    assert app.main(["build", str(out), *photos, "--recipe", recipe,
                     "--size", "30", "20"]) == 0
    result = Image.open(out)
    assert result.size == (30, 20)
    for frame in ImageSequence.Iterator(result):
        assert frame.size == (30, 20)


def test_gif_subcommand(tmp_path, recipe, photo):
    # first build a gif, then run the gif subcommand over it
    src = tmp_path / "src.gif"
    app.main(["build", str(src), photo, photo])
    out = tmp_path / "out.gif"
    assert app.main(["gif", recipe, str(src), str(out)]) == 0
    assert Image.open(out).format == "GIF"


def test_list_ops_subcommand(capsys):
    assert app.main(["list-ops"]) == 0
    captured = capsys.readouterr().out
    assert "editing operations available" in captured
    # core, plugin, and optional (ai/cv) ops all surface
    assert "Grayscale" in captured and "Vignette" in captured
    assert "Invert" in captured  # plugin
    assert "CLAHE" in captured and "Remove Background" in captured  # cv + ai


def test_build_video_subcommand(tmp_path, photos):
    pytest.importorskip("moviepy")
    out = tmp_path / "clip.mp4"
    assert app.main(["build", str(out), *photos, "--fps", "6"]) == 0
    assert os.path.exists(out) and os.path.getsize(out) > 0


def test_unknown_subcommand_errors():
    with pytest.raises(SystemExit):
        app.main(["nonsense"])
