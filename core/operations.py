"""Stateless, serializable image operations.

Each Operation renders itself onto a PIL image via apply() and can round-trip
through a plain dict (to_dict / operation_from_dict), so a Document's edit
"recipe" can be saved and reopened — the Lightroom model described in
PRO_DEVELOPMENT.md. Replaces the if/elif chain of the old
SimpleImageEditor.apply_filter.
"""
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

_REGISTRY = {}


def register(cls):
    """Class decorator adding an Operation to the registry.

    Public so plugins (see core/plugins.py) and optional packages like
    ai_tools can contribute operations without editing this module.
    """
    _REGISTRY[cls.__name__] = cls
    return cls


def registered_operations() -> dict:
    """Name -> Operation class for everything currently registered."""
    return dict(_REGISTRY)


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


@register
class Grayscale(Operation):
    label = "Grayscale"

    def apply(self, image):
        return ImageOps.grayscale(image).convert("RGB")


@register
class Sepia(Operation):
    label = "Sepia"

    _MATRIX = (
        0.393, 0.769, 0.189, 0,
        0.349, 0.686, 0.168, 0,
        0.272, 0.534, 0.131, 0,
    )

    def apply(self, image):
        return image.convert("RGB", self._MATRIX)


@register
class GaussianBlur(Operation):
    label = "Blur"

    def __init__(self, radius: float = 3):
        self.radius = radius

    def params(self):
        return {"radius": self.radius}

    def apply(self, image):
        return image.filter(ImageFilter.GaussianBlur(self.radius))


@register
class Rotate90(Operation):
    label = "Rotate 90°"

    def apply(self, image):
        return image.rotate(90, expand=True)


@register
class FlipHorizontal(Operation):
    label = "Flip Horizontal"

    def apply(self, image):
        return ImageOps.mirror(image)


@register
class FlipVertical(Operation):
    label = "Flip Vertical"

    def apply(self, image):
        return ImageOps.flip(image)


@register
class Brightness(Operation):
    label = "Brightness"

    def __init__(self, factor: float = 1.2):
        self.factor = factor

    def params(self):
        return {"factor": self.factor}

    def apply(self, image):
        return ImageEnhance.Brightness(image).enhance(self.factor)


@register
class Resize(Operation):
    label = "Resize"

    def __init__(self, width: int = 800, height: int = 600):
        self.width = width
        self.height = height

    def params(self):
        return {"width": self.width, "height": self.height}

    def apply(self, image):
        return image.resize((self.width, self.height))


@register
class MaskedOperation(Operation):
    """Apply another operation only inside a region (selective/local edit).

    The region is a rectangle or ellipse in image coordinates, optionally
    feathered by blurring the mask, so e.g. MaskedOperation(Brightness(1.4),
    region, shape="ellipse", feather=20) brightens just a subject. A brush
    mask UI can later produce arbitrary masks; the compositing path is the
    same. The wrapped operation must not change image dimensions — geometric
    ops (Rotate90, Resize) can't be masked and are applied unmasked.
    """

    label = "Masked"

    def __init__(self, operation, region, shape: str = "rectangle", feather: float = 0):
        if isinstance(operation, dict):
            operation = operation_from_dict(operation)
        if shape not in ("rectangle", "ellipse"):
            raise ValueError(f"Unknown mask shape: {shape!r}")
        self.operation = operation
        self.region = tuple(region)  # (x1, y1, x2, y2)
        self.shape = shape
        self.feather = feather

    def params(self):
        return {
            "operation": self.operation.to_dict(),
            "region": list(self.region),
            "shape": self.shape,
            "feather": self.feather,
        }

    def apply(self, image):
        edited = self.operation.apply(image)
        if edited.size != image.size:
            return edited

        mask = Image.new("L", image.size, 0)
        draw = ImageDraw.Draw(mask)
        if self.shape == "ellipse":
            draw.ellipse(self.region, fill=255)
        else:
            draw.rectangle(self.region, fill=255)
        if self.feather:
            mask = mask.filter(ImageFilter.GaussianBlur(self.feather))
        return Image.composite(edited, image, mask)
