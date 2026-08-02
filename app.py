"""Unified entry point for the photo editor — one command for everything.

Subcommands:
    gui                            launch the graphical editor
    image  RECIPE IN OUT           apply a recipe to a single image
    batch  RECIPE IN_DIR OUT_DIR   apply a recipe to a folder of images
    gif    RECIPE IN.gif OUT.gif   apply a recipe to every GIF frame
    video  RECIPE IN OUT           apply a recipe to every video frame
    build  OUT IMG [IMG ...]       build a GIF/video from still images
    togif  IN.mp4 OUT.gif          convert a video (or segment) into a GIF
    list-ops                       list all available editing operations

Examples:
    python app.py image look.json photo.jpg out.png
    python app.py build slideshow.gif a.jpg b.jpg c.jpg --duration 500
    python app.py build clip.mp4 frames/*.png --fps 24 --recipe look.json
    python app.py togif clip.mp4 out.gif --start 3 --end 8 --fps 12
    python app.py togif clip.mp4 loop.gif --size 480 270 --boomerang
    python app.py list-ops
"""
import argparse
import os
import sys

from core import Document, load_plugins, registered_operations
from core.document import operations_from_recipe


def _cmd_image(args):
    doc = Document.open(args.input)
    for operation in operations_from_recipe(args.recipe):
        doc.add_operation(operation)
    doc.export(args.output)
    print(f"OK   {args.input} -> {args.output}")
    return 0


def _cmd_batch(args):
    import batch_export
    return batch_export.main([args.recipe, args.input_dir, args.output_dir, "--format", args.format])


def _cmd_gif(args):
    import animate
    return animate.main([args.recipe, args.input, args.output])


def _cmd_video(args):
    import edit_video
    argv = [args.recipe, args.input, args.output]
    if args.no_audio:
        argv.append("--no-audio")
    return edit_video.main(argv)


def _cmd_build(args):
    operations = operations_from_recipe(args.recipe) if args.recipe else None
    size = tuple(args.size) if args.size else None
    ext = os.path.splitext(args.output)[1].lower()
    try:
        if ext == ".gif":
            from core.builder import build_gif
            count = build_gif(args.images, args.output, operations=operations,
                              duration=args.duration, size=size,
                              boomerang=args.boomerang)
        else:
            from video_tools import build_video
            count = build_video(args.images, args.output, operations=operations,
                                fps=args.fps, size=size)
    except Exception as e:
        print(f"FAIL {args.output}: {e}", file=sys.stderr)
        return 1
    print(f"OK   built {args.output} from {count} image(s)")
    return 0


def _cmd_togif(args):
    """Convert a video (or a segment of it) into an animated GIF."""
    operations = operations_from_recipe(args.recipe) if args.recipe else None
    size = tuple(args.size) if args.size else None
    try:
        from video_tools import video_to_gif
        count = video_to_gif(args.input, args.output, operations=operations,
                             start=args.start, end=args.end, fps=args.fps,
                             size=size, boomerang=args.boomerang)
    except Exception as e:
        print(f"FAIL {args.input}: {e}", file=sys.stderr)
        return 1
    print(f"OK   {args.input} -> {args.output} ({count} frames @ {args.fps}fps)")
    return 0


def _cmd_list_ops(args):
    # register optional ops too (safe to import without their heavy deps),
    # so the list reflects everything the app can offer
    for module in ("ai_tools", "cv_tools"):
        try:
            __import__(module)
        except Exception:
            pass
    load_plugins()
    ops = registered_operations()
    print(f"{len(ops)} editing operations available:\n")
    for name in sorted(ops):
        print(f"  {ops[name].label}  ({name})")
    return 0


def _cmd_gui(args):
    import photo_editor  # noqa: F401  (import launches nothing; __main__ guard)
    import tkinter as tk

    root = tk.Tk()
    root.geometry("900x850")
    photo_editor.AppGUI(root)
    root.protocol("WM_DELETE_WINDOW", root.quit)
    root.mainloop()
    return 0


def build_parser():
    parser = argparse.ArgumentParser(
        prog="app.py",
        description="Unified photo/GIF/video editor — one command for everything.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("image", help="apply a recipe to a single image")
    p.add_argument("recipe"); p.add_argument("input"); p.add_argument("output")
    p.set_defaults(func=_cmd_image)

    p = sub.add_parser("batch", help="apply a recipe to a folder of images")
    p.add_argument("recipe"); p.add_argument("input_dir"); p.add_argument("output_dir")
    p.add_argument("--format", choices=["png", "jpg"], default="png")
    p.set_defaults(func=_cmd_batch)

    p = sub.add_parser("gif", help="apply a recipe to every GIF frame")
    p.add_argument("recipe"); p.add_argument("input"); p.add_argument("output")
    p.set_defaults(func=_cmd_gif)

    p = sub.add_parser("video", help="apply a recipe to every video frame")
    p.add_argument("recipe"); p.add_argument("input"); p.add_argument("output")
    p.add_argument("--no-audio", action="store_true")
    p.set_defaults(func=_cmd_video)

    p = sub.add_parser("build", help="build a GIF/video from still images")
    p.add_argument("output", help="output file; .gif builds a GIF, else a video")
    p.add_argument("images", nargs="+", help="input still images, in order")
    p.add_argument("--recipe", help="optional recipe applied to each still")
    p.add_argument("--duration", type=int, default=200, help="GIF: ms per frame")
    p.add_argument("--fps", type=int, default=24, help="video: frames per second")
    p.add_argument("--size", type=int, nargs=2, metavar=("W", "H"),
                   help="resize all frames to WxH")
    p.add_argument("--boomerang", action="store_true",
                   help="GIF: play forward then backward (ping-pong)")
    p.set_defaults(func=_cmd_build)

    p = sub.add_parser("togif", help="convert a video (or a segment) into an animated GIF")
    p.add_argument("input", help="input video file")
    p.add_argument("output", help="output .gif")
    p.add_argument("--start", type=float, help="segment start in seconds")
    p.add_argument("--end", type=float, help="segment end in seconds")
    p.add_argument("--fps", type=int, default=10, help="GIF frame rate (default 10)")
    p.add_argument("--size", type=int, nargs=2, metavar=("W", "H"),
                   help="scale frames to WxH")
    p.add_argument("--recipe", help="optional recipe applied to each frame")
    p.add_argument("--boomerang", action="store_true",
                   help="play forward then backward (ping-pong)")
    p.set_defaults(func=_cmd_togif)

    p = sub.add_parser("list-ops", help="list all available editing operations")
    p.set_defaults(func=_cmd_list_ops)

    p = sub.add_parser("gui", help="launch the graphical editor")
    p.set_defaults(func=_cmd_gui)

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
