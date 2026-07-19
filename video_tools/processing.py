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


def _require_image_sequence_clip():
    try:
        import numpy as np
        from moviepy import ImageSequenceClip
    except ImportError as e:
        raise ImportError(
            "Video support requires the optional 'moviepy' package (and FFmpeg). "
            "Install it with: pip install -r requirements-video.txt"
        ) from e
    return np, ImageSequenceClip


def build_video(image_paths, out_path, operations=None, fps: int = 24,
                size=None, codec: str = "libx264") -> int:
    """Assemble still images into a video, optionally applying `operations` to
    each. Frames are unified to a single size. Returns frame count."""
    np, ImageSequenceClip = _require_image_sequence_clip()

    paths = list(image_paths)
    if not paths:
        raise ValueError("build_video needs at least one image")

    frames = []
    base = size
    for path in paths:
        image = Image.open(path).convert("RGB")
        if base is None:
            base = image.size
        if image.size != base:
            image = image.resize(base)
        for operation in operations or []:
            image = operation.apply(image)
            if image.size != base:
                image = image.resize(base)
        frames.append(np.asarray(image))

    clip = ImageSequenceClip(frames, fps=fps)
    try:
        clip.write_videofile(out_path, codec=codec, logger=None)
    finally:
        clip.close()
    return len(frames)


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
