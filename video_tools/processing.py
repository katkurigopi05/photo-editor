"""Apply an operation recipe to every frame of a video via MoviePy/FFmpeg.

Reuses the same Operation list as still-image and GIF editing. MoviePy (v2)
is imported lazily, so this module is safe to import without it installed;
using it then raises a clear requirements-video.txt hint. Audio is preserved.

Size-preserving operations (color/tone/detail/effects) are supported. Geometry
operations that change frame dimensions (Crop/Resize/Rotate) are not supported
for video in this first version — every frame must keep the clip's size.
"""
from PIL import Image


def _require_moviepy():
    try:
        import numpy as np
        import moviepy  # noqa: F401
        from moviepy import VideoFileClip
    except ImportError as e:
        raise ImportError(
            "Video support requires the optional 'moviepy' package (and FFmpeg). "
            "Install it with: pip install -r requirements-video.txt"
        ) from e
    return np, VideoFileClip


def apply_to_video(in_path: str, operations, out_path: str,
                   audio: bool = True, fps=None, codec: str = "libx264") -> None:
    """Apply `operations` to every frame of the video at `in_path` and write
    the result to `out_path`, preserving audio by default."""
    np, VideoFileClip = _require_moviepy()

    clip = VideoFileClip(in_path)
    try:
        width, height = clip.size

        def process(frame):
            edited = Image.fromarray(frame)
            for operation in operations:
                edited = operation.apply(edited)
            edited = edited.convert("RGB")
            if edited.size != (width, height):
                raise ValueError(
                    "Video operations must preserve frame size; got "
                    f"{edited.size} from a {(width, height)} clip. Geometry "
                    "ops that resize/crop aren't supported for video yet."
                )
            return np.asarray(edited)

        edited_clip = clip.image_transform(process)
        try:
            edited_clip.write_videofile(
                out_path,
                fps=fps or clip.fps,
                codec=codec,
                audio=audio,
                logger=None,
            )
        finally:
            edited_clip.close()
    finally:
        clip.close()
