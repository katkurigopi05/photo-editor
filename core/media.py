"""Media-type awareness so one application can edit photos, GIFs and video.

The editing recipe is identical across media — you edit a single preview frame
(the first frame for animations/video) and, on export, the same operation list
is applied to the whole thing: one still, every GIF frame, or every video
frame. This module is GUI-agnostic and headless-testable.
"""
import os

from PIL import Image

from .builder import build_gif  # noqa: F401  (re-exported for callers)
from .document import RAW_EXTENSIONS, Document
from .frames import apply_to_animation

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tiff"} | RAW_EXTENSIONS
GIF_EXTENSIONS = {".gif"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}


def detect_media_type(path: str) -> str:
    """Return 'image', 'gif', or 'video' for `path`. A single-frame GIF is
    treated as an image."""
    ext = os.path.splitext(path)[1].lower()
    if ext in VIDEO_EXTENSIONS:
        return "video"
    if ext in GIF_EXTENSIONS:
        try:
            with Image.open(path) as im:
                if getattr(im, "n_frames", 1) > 1:
                    return "gif"
        except Exception:
            pass
        return "image"
    return "image"


def first_frame(path: str, media_type: str = None) -> Image.Image:
    """Return the first frame as an RGB PIL image, for use as an edit preview."""
    media_type = media_type or detect_media_type(path)
    if media_type == "video":
        image = _video_first_frame(path)
    else:
        # Document.open handles RAW too; render() with no ops returns the base
        image = Document.open(path).render()
    return image.convert("RGB")


def _video_first_frame(path: str) -> Image.Image:
    try:
        from moviepy import VideoFileClip
    except ImportError as e:
        raise ImportError(
            "Opening video requires the optional 'moviepy' package. "
            "Install it with: pip install -r requirements-video.txt"
        ) from e
    clip = VideoFileClip(path)
    try:
        return Image.fromarray(clip.get_frame(0))
    finally:
        clip.close()


def export_media(media_type: str, source_path: str, operations, out_path: str):
    """Apply `operations` to the whole media and write it to `out_path`.

    - image: one still through the operation list
    - gif:   every frame (duration/loop preserved)
    - video: every frame (audio preserved), or converted to an animated GIF
             when `out_path` ends in .gif
    """
    out_ext = os.path.splitext(out_path)[1].lower()
    if media_type == "video" and out_ext == ".gif":
        # exporting a video to .gif converts it rather than re-encoding video
        from video_tools import video_to_gif
        return video_to_gif(source_path, out_path, operations)
    if media_type == "gif":
        return apply_to_animation(source_path, operations, out_path)
    if media_type == "video":
        from video_tools import apply_to_video
        apply_to_video(source_path, operations, out_path)
        return None
    document = Document.open(source_path)
    for operation in operations:
        document.add_operation(operation)
    document.export(out_path)
    return None
