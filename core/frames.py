"""Apply an operation recipe to every frame of an animated image.

Reuses the same Operation list as still-image editing, so any recipe (core
ops, cv_tools, ai_tools, masked ops) can be applied across the frames of an
animated GIF/WebP. Pillow-only — no FFmpeg required.

Frames are edited in RGB, so per-frame transparency is flattened; per-frame
timing (`duration`) and the loop count are preserved.
"""
from PIL import Image, ImageSequence


def _edit_frame(frame, operations):
    edited = frame.convert("RGB")
    for operation in operations:
        edited = operation.apply(edited)
    return edited


def render_frames(image: Image.Image, operations):
    """Yield each frame of `image` as an edited RGB frame."""
    for frame in ImageSequence.Iterator(image):
        yield _edit_frame(frame, operations)


def apply_to_animation(in_path: str, operations, out_path: str) -> int:
    """Apply `operations` to every frame of the animation at `in_path` and
    save the result to `out_path`. Returns the number of frames written."""
    image = Image.open(in_path)

    frames = []
    durations = []
    # a single iterator — two concurrent iterators would share the frame
    # pointer and interfere
    for frame in ImageSequence.Iterator(image):
        durations.append(frame.info.get("duration", image.info.get("duration", 100)))
        frames.append(_edit_frame(frame, operations))

    if not frames:
        raise ValueError(f"No frames found in {in_path!r}")

    loop = image.info.get("loop", 0)
    frames[0].save(
        out_path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=loop,
        format="GIF",
    )
    return len(frames)
