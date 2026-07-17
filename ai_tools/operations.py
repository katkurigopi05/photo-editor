"""AI-backed Operations plugging into the core registry.

Importing this module is cheap: it registers the operation classes but the
heavy dependencies (ultralytics, transformers, torch) are only imported
inside apply(), via ai_tools.detection / ai_tools.segmentation. If they're
missing, apply() raises the ImportError from those modules, which the GUI
surfaces with the requirements-ai.txt install hint.
"""
from PIL import Image

from core.operations import Operation, register


@register
class RemoveBackground(Operation):
    """Remove the background and flatten onto white (Document renders RGB)."""

    label = "Remove Background (AI)"

    def __init__(self, model_name: str = "briaai/RMBG-1.4"):
        self.model_name = model_name

    def params(self):
        return {"model_name": self.model_name}

    def apply(self, image):
        from .segmentation import remove_background

        rgba = remove_background(image, model_name=self.model_name)
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.split()[-1])
        return background


@register
class AutoCrop(Operation):
    """Crop to the highest-confidence detected subject, with a margin."""

    label = "Auto Crop (AI)"

    def __init__(self, weights: str = "yolov8n.pt", margin: float = 0.05):
        self.weights = weights
        self.margin = margin

    def params(self):
        return {"weights": self.weights, "margin": self.margin}

    def apply(self, image):
        from .detection import detect_objects

        detections = detect_objects(image, weights=self.weights)
        if not detections:
            return image  # nothing detected; crop is a no-op

        best = max(detections, key=lambda d: d.confidence)
        x1, y1, x2, y2 = best.box
        pad_x = (x2 - x1) * self.margin
        pad_y = (y2 - y1) * self.margin
        width, height = image.size
        return image.crop((
            max(0, int(x1 - pad_x)),
            max(0, int(y1 - pad_y)),
            min(width, int(x2 + pad_x)),
            min(height, int(y2 + pad_y)),
        ))
