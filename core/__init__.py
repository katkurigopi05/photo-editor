"""Non-destructive editing engine (see PRO_DEVELOPMENT.md, Phase 1).

This package is GUI-agnostic: nothing in here may import tkinter. The
Tkinter frontend (photo_editor.py) talks to Document and the Operation
classes only, so a future Qt or web frontend can reuse the same core.
"""
from .document import Document
from .operations import (
    Operation,
    Grayscale,
    Sepia,
    GaussianBlur,
    Rotate90,
    FlipHorizontal,
    FlipVertical,
    Brightness,
    Resize,
    operation_from_dict,
)

__all__ = [
    "Document",
    "Operation",
    "Grayscale",
    "Sepia",
    "GaussianBlur",
    "Rotate90",
    "FlipHorizontal",
    "FlipVertical",
    "Brightness",
    "Resize",
    "operation_from_dict",
]
