"""Optional AI-assisted tools (see PRO_DEVELOPMENT.md, Phase 5).

Nothing in photo_editor.py imports this package. It requires extra
dependencies (torch, ultralytics, transformers) listed in
requirements-ai.txt, which are NOT part of the core app's requirements.
Import from here only when AI features are explicitly enabled.
"""
from .detection import Detection, detect_objects
from .operations import AutoCrop, RemoveBackground
from .segmentation import remove_background

__all__ = [
    "Detection",
    "detect_objects",
    "remove_background",
    "AutoCrop",
    "RemoveBackground",
]
