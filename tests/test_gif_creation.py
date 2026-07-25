"""Tests for GIF creation: stills -> GIF, boomerang, and video -> GIF."""
import os
import sys

import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import Grayscale  # noqa: E402
from core.builder import boomerang_frames, build_gif, save_gif  # noqa: E402


@pytest.fixture
def stills(tmp_path):
    """Six visually distinct frames (distinct so the GIF writer can't dedupe)."""
    paths = []
    for i in range(6):
        p = tmp_path / f"f{i}.png"
        Image.new("RGB", (60, 40), (i * 40 % 256, 90, 200)).save(p)
        paths.append(str(p))
    return paths


# --- stills -> GIF ---

def test_build_gif_frame_count(tmp_path, stills):
    out = tmp_path / "o.gif"
    assert build_gif(stills, str(out)) == 6
    assert Image.open(out).n_frames == 6


def test_build_gif_applies_recipe_and_size(tmp_path, stills):
    out = tmp_path / "o.gif"
    build_gif(stills, str(out), operations=[Grayscale()], size=(30, 20))
    result = Image.open(out)
    assert result.size == (30, 20)


def test_build_gif_rejects_empty():
    with pytest.raises(ValueError):
        build_gif([], "out.gif")


# --- boomerang / ping-pong ---

def test_boomerang_frames_sequence():
    # 1,2,3,4 -> 1,2,3,4,3,2  (endpoints not duplicated)
    assert boomerang_frames([1, 2, 3, 4]) == [1, 2, 3, 4, 3, 2]


def test_boomerang_short_sequences_unchanged():
    assert boomerang_frames([1]) == [1]
    assert boomerang_frames([1, 2]) == [1, 2]


def test_build_gif_boomerang_doubles_back(tmp_path, stills):
    out = tmp_path / "b.gif"
    count = build_gif(stills, str(out), boomerang=True)
    assert count == 10  # 6 forward + 4 back
    assert Image.open(out).n_frames == 10


def test_save_gif_rejects_empty():
    with pytest.raises(ValueError):
        save_gif([], "out.gif")


def test_save_gif_unifies_mismatched_sizes(tmp_path):
    frames = [Image.new("RGB", (40, 30), (200, 0, 0)),
              Image.new("RGB", (20, 15), (0, 200, 0))]
    out = tmp_path / "u.gif"
    save_gif(frames, str(out))
    assert Image.open(out).size == (40, 30)


# --- video -> GIF ---

def _make_video(path, n_frames=12, size=(64, 48), fps=12):
    import numpy as np
    from moviepy import ImageSequenceClip
    frames = [np.full((size[1], size[0], 3), (i * 20 % 256, 80, 160), dtype=np.uint8)
              for i in range(n_frames)]
    ImageSequenceClip(frames, fps=fps).write_videofile(path, codec="libx264", logger=None)


def test_video_to_gif(tmp_path):
    pytest.importorskip("moviepy")
    from video_tools import video_to_gif

    src = str(tmp_path / "in.mp4")
    _make_video(src)                      # 12 frames @ 12fps = 1 second
    out = tmp_path / "out.gif"
    count = video_to_gif(src, str(out), fps=6)   # resample to 6fps
    result = Image.open(out)
    assert result.format == "GIF"
    assert result.n_frames == count
    assert count < 12                     # downsampled from the video's rate


def test_video_to_gif_segment_and_size(tmp_path):
    pytest.importorskip("moviepy")
    from video_tools import video_to_gif

    src = str(tmp_path / "in.mp4")
    _make_video(src, n_frames=24, fps=12)  # 2 seconds
    out = tmp_path / "seg.gif"
    video_to_gif(src, str(out), start=0.5, end=1.0, fps=10, size=(32, 24))
    result = Image.open(out)
    assert result.size == (32, 24)
    assert result.n_frames <= 7            # ~0.5s at 10fps


def test_video_to_gif_with_recipe_and_boomerang(tmp_path):
    pytest.importorskip("moviepy")
    from video_tools import video_to_gif

    src = str(tmp_path / "in.mp4")
    _make_video(src)
    plain = tmp_path / "p.gif"
    boomed = tmp_path / "b.gif"
    n_plain = video_to_gif(src, str(plain), operations=[Grayscale()], fps=6)
    n_boom = video_to_gif(src, str(boomed), fps=6, boomerang=True)
    assert n_boom > n_plain


# --- CLI + media routing ---

def test_togif_cli(tmp_path):
    pytest.importorskip("moviepy")
    import app

    src = str(tmp_path / "in.mp4")
    _make_video(src)
    out = tmp_path / "cli.gif"
    assert app.main(["togif", src, str(out), "--fps", "6"]) == 0
    assert Image.open(out).format == "GIF"


def test_build_cli_boomerang(tmp_path, stills):
    import app
    out = tmp_path / "cli.gif"
    assert app.main(["build", str(out), *stills, "--boomerang"]) == 0
    assert Image.open(out).n_frames == 10


def test_export_media_video_to_gif_by_extension(tmp_path):
    """Exporting an open video to a .gif path converts instead of re-encoding."""
    pytest.importorskip("moviepy")
    from core.media import export_media

    src = str(tmp_path / "in.mp4")
    _make_video(src)
    out = tmp_path / "exported.gif"
    export_media("video", src, [Grayscale()], str(out))
    assert Image.open(out).format == "GIF"
