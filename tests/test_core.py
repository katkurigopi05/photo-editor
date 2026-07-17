"""Headless tests for the non-destructive core (no GUI, no display needed).

Covers the parts that run in a remote sandbox: operations, the Document
state machine, masking, recipe round-trips, plugin loading, and the
batch_export CLI. The Tkinter GUI is not exercised (no display available).
"""
import json
import os
import sys

import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import (  # noqa: E402
    Document, Grayscale, Sepia, GaussianBlur, Rotate90, FlipHorizontal,
    FlipVertical, Brightness, Resize, MaskedOperation,
    operation_from_dict, load_plugins, registered_operations,
)


@pytest.fixture
def sample(tmp_path):
    path = tmp_path / "src.png"
    img = Image.new("RGB", (120, 90))
    img.putdata([((x * 2) % 256, (y * 3) % 256, (x + y) % 256)
                 for y in range(90) for x in range(120)])
    img.save(path)
    return str(path), img


def test_core_filters_preserve_rgb(sample):
    path, _ = sample
    doc = Document.open(path)
    for op in [Grayscale(), Sepia(), GaussianBlur(3), Brightness(1.2),
               Brightness(0.8), FlipHorizontal(), FlipVertical()]:
        doc.add_operation(op)
    out = doc.render()
    assert out.mode == "RGB"
    assert out.size == (120, 90)


def test_geometry_ops_change_size(sample):
    path, _ = sample
    doc = Document.open(path)
    doc.add_operation(Rotate90())
    assert doc.render().size == (90, 120)
    doc.add_operation(Resize(50, 40))
    assert doc.render().size == (50, 40)


def test_masked_operation_is_partial(sample):
    path, img = sample
    doc = Document.open(path)
    doc.add_operation(MaskedOperation(Brightness(2.0), (10, 10, 60, 50),
                                      shape="ellipse", feather=8))
    masked = doc.render()
    assert masked.size == (120, 90)
    full = Brightness(2.0).apply(img.convert("RGB"))
    assert masked.tobytes() != full.tobytes()
    assert masked.tobytes() != img.tobytes()


def test_masked_size_changing_op_falls_back(sample):
    path, _ = sample
    doc = Document.open(path)
    doc.add_operation(MaskedOperation(Resize(10, 10), (0, 0, 5, 5)))
    assert doc.render().size == (10, 10)


def test_undo_redo_is_pixel_exact(sample):
    path, _ = sample
    doc = Document.open(path)
    doc.add_operation(Grayscale())
    gray = doc.render().tobytes()
    doc.add_operation(Sepia())
    doc.undo()
    assert doc.render().tobytes() == gray
    doc.redo()
    sepia = doc.render().tobytes()
    doc.undo()
    doc.redo()
    assert doc.render().tobytes() == sepia


def test_new_op_after_undo_truncates_redo(sample):
    path, _ = sample
    doc = Document.open(path)
    doc.add_operation(Grayscale())
    doc.add_operation(Sepia())
    doc.undo()
    doc.add_operation(Brightness(1.1))
    assert not doc.redo()
    assert [type(o).__name__ for o in doc.operations] == ["Grayscale", "Brightness"]


def test_recipe_round_trip_is_pixel_exact(tmp_path, sample):
    path, _ = sample
    doc = Document.open(path)
    doc.add_operation(MaskedOperation(Brightness(1.5), (5, 5, 40, 30), feather=4))
    doc.add_operation(Grayscale())
    recipe = tmp_path / "r.json"
    doc.save_recipe(str(recipe))
    reloaded = Document.load_recipe(str(recipe))
    assert reloaded.render().tobytes() == doc.render().tobytes()


def test_export_png_and_jpeg(tmp_path, sample):
    path, _ = sample
    doc = Document.open(path)
    doc.add_operation(Grayscale())
    png_path, jpg_path = tmp_path / "o.png", tmp_path / "o.jpg"
    doc.export(str(png_path))
    doc.export(str(jpg_path))
    assert Image.open(png_path).size == (120, 90)
    assert Image.open(jpg_path).format == "JPEG"


def test_operation_from_dict_rejects_unknown():
    with pytest.raises(ValueError):
        operation_from_dict({"op": "NoSuchOp", "params": {}})


def test_plugin_loads_and_is_correct(sample):
    _, img = sample
    loaded = load_plugins()
    assert "Invert" in loaded
    Invert = registered_operations()["Invert"]
    rgb = img.convert("RGB")
    out = Invert().apply(rgb)
    assert out.getpixel((0, 0)) == tuple(255 - c for c in rgb.getpixel((0, 0)))


def test_batch_export_processes_folder(tmp_path, sample):
    path, img = sample
    import batch_export

    in_dir, out_dir = tmp_path / "in", tmp_path / "out"
    in_dir.mkdir()
    for name in ("a.png", "b.jpg"):
        img.save(in_dir / name)
    (in_dir / "skip.txt").write_text("not an image")

    recipe = tmp_path / "r.json"
    recipe.write_text(json.dumps({
        "version": 1,
        "operations": [Grayscale().to_dict()],
    }))

    rc = batch_export.main([str(recipe), str(in_dir), str(out_dir), "--format", "png"])
    assert rc == 0
    assert sorted(os.listdir(out_dir)) == ["a.png", "b.png"]
