"""Stateless, serializable image operations.

Each Operation renders itself onto a PIL image via apply() and can round-trip
through a plain dict (to_dict / operation_from_dict), so a Document's edit
"recipe" can be saved and reopened — the Lightroom model described in
PRO_DEVELOPMENT.md. Replaces the if/elif chain of the old
SimpleImageEditor.apply_filter.
"""
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

_REGISTRY = {}


def _register(cls):
    _REGISTRY[cls.__name__] = cls
    return cls


class Operation:
    """Base class. Subclasses set `label` and implement apply()."""

    label = "Operation"

    def apply(self, image: Image.Image) -> Image.Image:
        raise NotImplementedError

    def params(self) -> dict:
        return {}

    def to_dict(self) -> dict:
        return {"op": type(self).__name__, "params": self.params()}


def operation_from_dict(data: dict) -> Operation:
    cls = _REGISTRY.get(data.get("op"))
    if cls is None:
        raise ValueError(f"Unknown operation: {data.get('op')!r}")
    return cls(**data.get("params", {}))


@_register
class Grayscale(Operation):
    label = "Grayscale"

    def apply(self, image):
        return ImageOps.grayscale(image).convert("RGB")


@_register
class Sepia(Operation):
    label = "Sepia"

    _MATRIX = (
        0.393, 0.769, 0.189, 0,
        0.349, 0.686, 0.168, 0,
        0.272, 0.534, 0.131, 0,
    )

    def apply(self, image):
        return image.convert("RGB", self._MATRIX)


@_register
class GaussianBlur(Operation):
    label = "Blur"

    def __init__(self, radius: float = 3):
        self.radius = radius

    def params(self):
        return {"radius": self.radius}

    def apply(self, image):
        return image.filter(ImageFilter.GaussianBlur(self.radius))


@_register
class Rotate90(Operation):
    label = "Rotate 90°"

    def apply(self, image):
        return image.rotate(90, expand=True)


@_register
class FlipHorizontal(Operation):
    label = "Flip Horizontal"

    def apply(self, image):
        return ImageOps.mirror(image)


@_register
class FlipVertical(Operation):
    label = "Flip Vertical"

    def apply(self, image):
        return ImageOps.flip(image)


@_register
class Brightness(Operation):
    label = "Brightness"

    def __init__(self, factor: float = 1.2):
        self.factor = factor

    def params(self):
        return {"factor": self.factor}

    def apply(self, image):
        return ImageEnhance.Brightness(image).enhance(self.factor)


@_register
class Resize(Operation):
    label = "Resize"

    def __init__(self, width: int = 800, height: int = 600):
        self.width = width
        self.height = height

    def params(self):
        return {"width": self.width, "height": self.height}

    def apply(self, image):
        return image.resize((self.width, self.height))
