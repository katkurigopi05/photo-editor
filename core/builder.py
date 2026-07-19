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


def build_gif(image_paths, out_path, operations=None, duration: int = 200,
              loop: int = 0, size=None) -> int:
    """Assemble `image_paths` into an animated GIF. Frames are unified to a
    single size (the first frame's, or `size` if given). Returns frame count."""
    paths = list(image_paths)
    if not paths:
        raise ValueError("build_gif needs at least one image")

    frames = [_load_and_edit(p, operations, size) for p in paths]
    base = size or frames[0].size
    frames = [f if f.size == base else f.resize(base) for f in frames]

    frames[0].save(
        out_path,
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=loop,
        format="GIF",
    )
    return len(frames)
