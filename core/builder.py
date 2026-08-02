"""Build an animation from a sequence of still images.

This is the inverse of core/frames.py: instead of editing an existing
animation, it assembles separate still images into an animated GIF (and,
via video_tools, into a video). An optional operation recipe is applied to
every still first, so you can, e.g., turn a folder of photos into a
consistently-graded slideshow GIF.
"""
from PIL import Image


def _load_and_edit(path, operations, size):
    image = Image.open(path).convert("RGB")
    if size is not None:
        image = image.resize(size)
    for operation in operations or []:
        image = operation.apply(image)
    return image


def boomerang_frames(frames):
    """Return frames + their reverse (minus the duplicated end frames), so the
    animation plays forward then backward — the classic 'ping-pong' GIF."""
    if len(frames) < 3:
        return list(frames)
    return list(frames) + list(frames)[-2:0:-1]


def save_gif(frames, out_path, duration=200, loop: int = 0, boomerang: bool = False) -> int:
    """Write PIL frames out as an animated GIF. Frames are unified to the first
    frame's size. `duration` is milliseconds per frame (an int, or a per-frame
    list). Returns the number of frames written."""
    frames = list(frames)
    if not frames:
        raise ValueError("save_gif needs at least one frame")

    base = frames[0].size
    frames = [f if f.size == base else f.resize(base) for f in frames]
    if boomerang:
        frames = boomerang_frames(frames)
        if isinstance(duration, list):
            duration = boomerang_frames(duration)

    frames[0].save(
        out_path,
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=loop,
        format="GIF",
    )
    return len(frames)


def build_gif(image_paths, out_path, operations=None, duration: int = 200,
              loop: int = 0, size=None, boomerang: bool = False) -> int:
    """Assemble `image_paths` into an animated GIF. Frames are unified to a
    single size (the first frame's, or `size` if given). Returns frame count."""
    paths = list(image_paths)
    if not paths:
        raise ValueError("build_gif needs at least one image")

    frames = [_load_and_edit(p, operations, size) for p in paths]
    return save_gif(frames, out_path, duration=duration, loop=loop, boomerang=boomerang)
