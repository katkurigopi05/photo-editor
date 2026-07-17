"""Example plugin: color inversion (negative).

Demonstrates the plugin contract from PRO_DEVELOPMENT.md Phase 4 — drop a
.py file in plugins/ defining Operation subclasses decorated with
core.operations.register, and the editor picks them up at startup with no
changes to the core.
"""
from PIL import ImageOps

from core.operations import Operation, register


@register
class Invert(Operation):
    label = "Invert"

    def apply(self, image):
        return ImageOps.invert(image)
