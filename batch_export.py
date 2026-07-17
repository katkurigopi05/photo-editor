"""Apply a saved edit recipe to every image in a folder (Phase 6).

Usage:
    python batch_export.py recipe.json input_dir output_dir [--format png|jpg]

The recipe is the JSON produced by "Save Recipe" in the editor (or
Document.save_recipe); its source image is ignored — only the operation
list is applied, once per input image.
"""
import argparse
import os
import sys

from core import Document
from core.document import RAW_EXTENSIONS, operations_from_recipe

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"} | RAW_EXTENSIONS


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("recipe", help="recipe JSON file")
    parser.add_argument("input_dir", help="folder of images to process")
    parser.add_argument("output_dir", help="folder for exported images")
    parser.add_argument("--format", choices=["png", "jpg"], default="png")
    args = parser.parse_args(argv)

    operations = operations_from_recipe(args.recipe)
    os.makedirs(args.output_dir, exist_ok=True)

    processed = failed = 0
    for filename in sorted(os.listdir(args.input_dir)):
        stem, ext = os.path.splitext(filename)
        if ext.lower() not in IMAGE_EXTENSIONS:
            continue
        source = os.path.join(args.input_dir, filename)
        target = os.path.join(args.output_dir, f"{stem}.{args.format}")
        try:
            document = Document.open(source)
            for operation in operations:
                document.add_operation(operation)
            document.export(target)
        except Exception as e:
            failed += 1
            print(f"FAIL {filename}: {e}", file=sys.stderr)
        else:
            processed += 1
            print(f"OK   {filename} -> {os.path.basename(target)}")

    print(f"Done: {processed} processed, {failed} failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
