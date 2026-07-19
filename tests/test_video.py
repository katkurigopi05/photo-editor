"""Tests for video frame editing (Phase B).

The real-processing tests importorskip moviepy so the suite still passes when
the optional dep is absent. The graceful-degradation test runs regardless.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import Grayscale, Brightness, Resize  # noqa: E402


def _make_video(path, n_frames=6, size=(48, 32), fps=6):
    import numpy as np
    from moviepy import ImageSequenceClip

    frames = [
        np.full((size[1], size[0], 3), (i * 40 % 256, 90, 160), dtype=np.uint8)
        for i in range(n_frames)
    ]
    ImageSequenceClip(frames, fps=fps).write_videofile(path, codec="libx264", logger=None)


def test_graceful_error_when_moviepy_missing(monkeypatch):
    import video_tools.processing as proc

    def boom():
        raise ImportError("Video support requires ... requirements-video.txt")

    monkeypatch.setattr(proc, "_require_moviepy", boom)
    with pytest.raises(ImportError, match="requirements-video.txt"):
        proc.apply_to_video("in.mp4", [Grayscale()], "out.mp4")


def test_apply_to_video_runs(tmp_path):
    pytest.importorskip("moviepy")
    from video_tools import apply_to_video

    src = str(tmp_path / "in.mp4")
    out = str(tmp_path / "out.mp4")
    _make_video(src)
    apply_to_video(src, [Grayscale(), Brightness(1.1)], out, audio=False)

    assert os.path.exists(out) and os.path.getsize(out) > 0
    from moviepy import VideoFileClip
    clip = VideoFileClip(out)
    try:
        assert clip.size == [48, 32]
    finally:
        clip.close()


def test_apply_to_video_from_recipe(tmp_path):
    pytest.importorskip("moviepy")
    from video_tools import apply_to_video

    src = str(tmp_path / "in.mp4")
    out = str(tmp_path / "out.mp4")
    _make_video(src)
    recipe = tmp_path / "r.json"
    recipe.write_text(json.dumps({"version": 1, "operations": [Grayscale().to_dict()]}))
    from core.document import operations_from_recipe
    apply_to_video(src, operations_from_recipe(str(recipe)), out, audio=False)
    assert os.path.exists(out) and os.path.getsize(out) > 0


def test_size_changing_op_rejected_for_video(tmp_path):
    pytest.importorskip("moviepy")
    from video_tools import apply_to_video

    src = str(tmp_path / "in.mp4")
    out = str(tmp_path / "out.mp4")
    _make_video(src)
    with pytest.raises(ValueError, match="preserve frame size"):
        apply_to_video(src, [Resize(10, 10)], out, audio=False)


def test_edit_video_cli(tmp_path):
    pytest.importorskip("moviepy")
    import edit_video

    src = str(tmp_path / "in.mp4")
    out = str(tmp_path / "out.mp4")
    _make_video(src)
    recipe = tmp_path / "r.json"
    recipe.write_text(json.dumps({"version": 1, "operations": [Grayscale().to_dict()]}))
    rc = edit_video.main([str(recipe), src, out, "--no-audio"])
    assert rc == 0
    assert os.path.exists(out)
