"""Tests for the media-type layer that lets one app edit photos/GIFs/video."""
import os
import sys

import pytest
from PIL import Image, ImageSequence

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import Grayscale, Resize  # noqa: E402
from core.media import detect_media_type, first_frame, export_media  # noqa: E402


@pytest.fixture
def photo(tmp_path):
    p = tmp_path / "p.png"
    Image.new("RGB", (50, 40), (120, 60, 200)).save(p)
    return str(p)


@pytest.fixture
def gif(tmp_path):
    p = tmp_path / "a.gif"
    frames = [Image.new("RGB", (50, 40), (i * 60 % 256, 80, 160)) for i in range(4)]
    frames[0].save(p, save_all=True, append_images=frames[1:], duration=100, loop=0)
    return str(p)


def test_detect_image(photo):
    assert detect_media_type(photo) == "image"


def test_detect_gif(gif):
    assert detect_media_type(gif) == "gif"


def test_detect_single_frame_gif_is_image(tmp_path):
    p = tmp_path / "single.gif"
    Image.new("RGB", (10, 10), (1, 2, 3)).save(p)  # one frame
    assert detect_media_type(str(p)) == "image"


def test_detect_video_by_extension():
    assert detect_media_type("clip.mp4") == "video"
    assert detect_media_type("clip.MOV") == "video"


def test_first_frame_image(photo):
    frame = first_frame(photo)
    assert frame.mode == "RGB" and frame.size == (50, 40)


def test_first_frame_gif_returns_frame_zero(gif):
    frame = first_frame(gif, "gif")
    assert frame.size == (50, 40)


def test_export_image(tmp_path, photo):
    out = tmp_path / "out.png"
    export_media("image", photo, [Grayscale()], str(out))
    assert Image.open(out).size == (50, 40)


def test_export_gif_applies_to_all_frames(tmp_path, gif):
    out = tmp_path / "out.gif"
    n = export_media("gif", gif, [Resize(25, 20)], str(out))
    assert n == 4
    result = Image.open(out)
    for frame in ImageSequence.Iterator(result):
        assert frame.size == (25, 20)


def test_export_video(tmp_path, photo):
    pytest.importorskip("moviepy")
    from video_tools import build_video
    src = str(tmp_path / "in.mp4")
    build_video([photo, photo, photo], src, fps=6)
    out = tmp_path / "out.mp4"
    export_media("video", src, [Grayscale()], str(out))
    assert os.path.exists(out) and os.path.getsize(out) > 0
