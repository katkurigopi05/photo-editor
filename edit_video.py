"""Apply a saved edit recipe to every frame of a video (Phase B).

Usage:
    python edit_video.py recipe.json input.mp4 output.mp4 [--no-audio]

The recipe is the JSON produced by "Save Recipe" in the editor; only the
operation list is applied. Requires requirements-video.txt (MoviePy/FFmpeg).
Size-changing geometry ops (crop/resize/rotate) aren't supported for video.
"""
import argparse
import sys

from core.document import operations_from_recipe
from video_tools import apply_to_video


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("recipe", help="recipe JSON file")
    parser.add_argument("input", help="input video file")
    parser.add_argument("output", help="output video file")
    parser.add_argument("--no-audio", action="store_true", help="drop the audio track")
    args = parser.parse_args(argv)

    operations = operations_from_recipe(args.recipe)
    try:
        apply_to_video(args.input, operations, args.output, audio=not args.no_audio)
    except Exception as e:
        print(f"FAIL {args.input}: {e}", file=sys.stderr)
        return 1
    print(f"OK   {args.input} -> {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
