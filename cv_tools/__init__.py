"""Optional OpenCV + NumPy image operations (see PRO_DEVELOPMENT.md).

These register into the core operation registry like any other Operation,
but require the optional dependencies in requirements-cv.txt. Importing this
package is safe without them installed; the heavy imports are deferred until
an operation's apply() runs, which then raises a clear ImportError if the
packages are missing.
"""
from .operations import (
    CLAHE,
    Denoise,
    BilateralFilter,
    UnsharpMask,
    RemoveObject,
)

__all__ = ["CLAHE", "Denoise", "BilateralFilter", "UnsharpMask", "RemoveObject"]
