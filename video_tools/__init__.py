"""Optional video support (see PRO_DEVELOPMENT.md, Phase B).

Applies the same operation recipe used for still images and GIFs to every
frame of a video via MoviePy/FFmpeg. Requires requirements-video.txt; the
heavy import is deferred so this package is safe to import without it.
"""
from .processing import apply_to_video, build_video, video_to_gif

__all__ = ["apply_to_video", "build_video", "video_to_gif"]
