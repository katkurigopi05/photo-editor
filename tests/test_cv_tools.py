"""Tests for the optional OpenCV-backed operations (cv_tools).

The real-operation tests importorskip cv2/numpy so the suite still passes
when the optional deps aren't installed. The graceful-degradation test runs
regardless: it confirms that invoking an op without the deps raises a clear,
install-pointing ImportError.
"""
import os
import sys

import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import operation_from_dict, registered_operations  # noqa: E402
from cv_tools import (  # noqa: E402
    CLAHE, Denoise, BilateralFilter, UnsharpMask, RemoveObject,
)


@pytest.fixture
def img():
    im = Image.new("RGB", (80, 60))
    im.putdata([((x * 3) % 256, (y * 4) % 256, (x * y) % 256)
                for y in range(60) for x in range(80)])
    return im


def test_cv_ops_register_without_opencv_installed():
    # importing cv_tools must register the classes even if cv2 is absent
    for name in ("CLAHE", "Denoise", "BilateralFilter", "UnsharpMask", "RemoveObject"):
        assert name in registered_operations()


def test_graceful_error_when_deps_missing(monkeypatch, img):
    import cv_tools.operations as ops

    def boom():
        raise ImportError("OpenCV operations require ... requirements-cv.txt")

    monkeypatch.setattr(ops, "require_cv", boom)
    with pytest.raises(ImportError, match="requirements-cv.txt"):
        CLAHE().apply(img)


def test_removeobject_validates_args():
    with pytest.raises(ValueError):
        RemoveObject(0, 0, 10, 10, shape="triangle")
    with pytest.raises(ValueError):
        RemoveObject(0, 0, 10, 10, method="magic")


CV_OPS = [
    CLAHE(2.0, 8),
    Denoise(8, 8),
    BilateralFilter(9, 75, 75),
    UnsharpMask(2.0, 1.0),
    RemoveObject(20, 15, 50, 40, shape="ellipse"),
]


@pytest.mark.parametrize("op", CV_OPS, ids=lambda o: type(o).__name__)
def test_cv_op_runs(op, img):
    pytest.importorskip("cv2")
    pytest.importorskip("numpy")
    out = op.apply(img)
    assert out.mode == "RGB"
    assert out.size == img.size


@pytest.mark.parametrize("op", CV_OPS, ids=lambda o: type(o).__name__)
def test_cv_op_round_trips_through_dict(op):
    restored = operation_from_dict(op.to_dict())
    assert type(restored) is type(op)
    assert restored.to_dict() == op.to_dict()


def test_cv_ops_compose_in_document(tmp_path, img):
    pytest.importorskip("cv2")
    from core import Document

    src = tmp_path / "src.png"
    img.save(src)
    doc = Document.open(str(src))
    doc.add_operation(CLAHE())
    doc.add_operation(Denoise(6, 6))
    doc.add_operation(UnsharpMask(1.5, 0.8))
    rendered = doc.render()
    assert rendered.size == img.size

    recipe = tmp_path / "r.json"
    doc.save_recipe(str(recipe))
    reloaded = Document.load_recipe(str(recipe))
    assert reloaded.render().tobytes() == rendered.tobytes()
