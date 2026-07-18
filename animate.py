"""Apply a saved edit recipe to every frame of an animated GIF (Phase A).

Usage:
    python animate.py recipe.json input.gif output.gif

The recipe is the JSON produced by "Save Recipe" in the editor (or
Document.save_recipe); its source image is ignored — only the operation
list is applied, once per frame. Pillow-only, no FFmpeg needed.
"""
import argparse
import sys

from core.document import operations_from_recipe
from core.frames import apply_to_animation


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("recipe", help="recipe JSON file")
    parser.add_argument("input", help="input animated GIF")
    parser.add_argument("output", help="output animated GIF")
    args = parser.parse_args(argv)

    operations = operations_from_recipe(args.recipe)
    try:
        count = apply_to_animation(args.input, operations, args.output)
    except Exception as e:
        print(f"FAIL {args.input}: {e}", file=sys.stderr)
        return 1
    print(f"OK   {args.input} -> {args.output} ({count} frames)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
