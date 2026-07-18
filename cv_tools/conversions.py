"""PIL <-> OpenCV conversion helpers with lazy dependency loading.

cv2 and numpy are imported only when a conversion actually runs, so
cv_tools can be imported (and its operations registered) without the
optional dependencies installed. If they're missing, a clear ImportError
points at requirements-cv.txt.
"""
from PIL import Image


def require_cv():
    """Return (cv2, numpy), or raise a helpful ImportError."""
    try:
        import cv2
        import numpy as np
    except ImportError as e:
        raise ImportError(
            "OpenCV operations require the optional 'opencv-python-headless' "
            "and 'numpy' packages. Install them with: "
            "pip install -r requirements-cv.txt"
        ) from e
    return cv2, np


def pil_to_cv(image):
    """PIL RGB image -> OpenCV BGR ndarray."""
    cv2, np = require_cv()
    arr = np.asarray(image.convert("RGB"))
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def cv_to_pil(arr):
    """OpenCV BGR ndarray -> PIL RGB image."""
    cv2, _ = require_cv()
    return Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB))
