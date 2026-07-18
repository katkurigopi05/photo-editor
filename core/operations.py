"""Stateless, serializable image operations.

Each Operation renders itself onto a PIL image via apply() and can round-trip
through a plain dict (to_dict / operation_from_dict), so a Document's edit
"recipe" can be saved and reopened — the Lightroom model described in
PRO_DEVELOPMENT.md. Replaces the if/elif chain of the old
SimpleImageEditor.apply_filter.
"""
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps, ImageStat

_REGISTRY = {}


def _clamp(value) -> int:
    return 0 if value < 0 else 255 if value > 255 else int(value)


def _apply_channel_luts(image, r_lut, g_lut, b_lut):
    """Apply a separate 256-entry lookup table to each RGB channel."""
    r, g, b = image.split()
    return Image.merge("RGB", (r.point(r_lut), g.point(g_lut), b.point(b_lut)))


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


# --- Light / tone ---------------------------------------------------------

@register
class Contrast(Operation):
    label = "Contrast"

    def __init__(self, factor: float = 1.2):
        self.factor = factor

    def params(self):
        return {"factor": self.factor}

    def apply(self, image):
        return ImageEnhance.Contrast(image).enhance(self.factor)


@register
class Highlights(Operation):
    """Adjust the bright tones. amount in [-100, 100]; negative recovers
    (darkens) blown highlights, positive brightens them."""

    label = "Highlights"

    def __init__(self, amount: float = 0):
        self.amount = amount

    def params(self):
        return {"amount": self.amount}

    def apply(self, image):
        shift = self.amount  # up to +/-100 levels at the brightest tones
        lut = [_clamp(v + shift * (v / 255) ** 2) for v in range(256)]
        return image.point(lut * len(image.getbands()))


@register
class Shadows(Operation):
    """Adjust the dark tones. amount in [-100, 100]; positive lifts shadows,
    negative deepens them."""

    label = "Shadows"

    def __init__(self, amount: float = 0):
        self.amount = amount

    def params(self):
        return {"amount": self.amount}

    def apply(self, image):
        shift = self.amount
        lut = [_clamp(v + shift * (1 - v / 255) ** 2) for v in range(256)]
        return image.point(lut * len(image.getbands()))


@register
class Levels(Operation):
    """Map input range [black, white] to full output range with a gamma
    (midtone) correction, like the Levels dialog in Photoshop/GIMP/Pixlr."""

    label = "Levels"

    def __init__(self, black: int = 0, white: int = 255, gamma: float = 1.0):
        if white <= black:
            raise ValueError("Levels: white point must be greater than black point")
        if gamma <= 0:
            raise ValueError("Levels: gamma must be positive")
        self.black = black
        self.white = white
        self.gamma = gamma

    def params(self):
        return {"black": self.black, "white": self.white, "gamma": self.gamma}

    def apply(self, image):
        span = self.white - self.black
        inv_gamma = 1.0 / self.gamma
        lut = []
        for v in range(256):
            t = (v - self.black) / span
            t = 0.0 if t < 0 else 1.0 if t > 1 else t
            lut.append(_clamp(255 * (t ** inv_gamma)))
        return image.point(lut * len(image.getbands()))


@register
class Curves(Operation):
    """Tone curve through control points [[x, y], ...] in 0..255, linearly
    interpolated into a lookup table (the Curves tool)."""

    label = "Curves"

    def __init__(self, points=None):
        pts = sorted((int(x), int(y)) for x, y in (points or [[0, 0], [255, 255]]))
        if len(pts) < 2:
            raise ValueError("Curves: need at least two control points")
        self.points = [list(p) for p in pts]

    def params(self):
        return {"points": [list(p) for p in self.points]}

    def _lut(self):
        pts = self.points
        lut = []
        for v in range(256):
            # find the segment [x0,y0]-[x1,y1] containing v
            if v <= pts[0][0]:
                lut.append(_clamp(pts[0][1]))
                continue
            if v >= pts[-1][0]:
                lut.append(_clamp(pts[-1][1]))
                continue
            for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                if x0 <= v <= x1:
                    frac = 0 if x1 == x0 else (v - x0) / (x1 - x0)
                    lut.append(_clamp(y0 + frac * (y1 - y0)))
                    break
        return lut

    def apply(self, image):
        return image.point(self._lut() * len(image.getbands()))


@register
class AutoContrast(Operation):
    """Stretch tones to full range, dropping `cutoff` percent at each end."""

    label = "Auto Contrast"

    def __init__(self, cutoff: float = 1):
        self.cutoff = cutoff

    def params(self):
        return {"cutoff": self.cutoff}

    def apply(self, image):
        return ImageOps.autocontrast(image, cutoff=self.cutoff)


@register
class Equalize(Operation):
    """Equalize the image histogram for maximum tonal spread."""

    label = "Equalize"

    def apply(self, image):
        return ImageOps.equalize(image)


# --- Color ----------------------------------------------------------------

@register
class Saturation(Operation):
    label = "Saturation"

    def __init__(self, factor: float = 1.3):
        self.factor = factor

    def params(self):
        return {"factor": self.factor}

    def apply(self, image):
        return ImageEnhance.Color(image).enhance(self.factor)


@register
class Vibrance(Operation):
    """Boost saturation of the less-saturated pixels while protecting the
    already-saturated ones (Lightroom/Snapseed vibrance). amount in
    [-100, 100]."""

    label = "Vibrance"

    def __init__(self, amount: float = 30):
        self.amount = amount

    def params(self):
        return {"amount": self.amount}

    def apply(self, image):
        k = self.amount / 100.0
        # protect low saturation (grays) and high saturation (already vivid);
        # push midtone saturations the most
        s_lut = [_clamp(s + k * (255 - s) * (s / 255)) for s in range(256)]
        h, s, v = image.convert("HSV").split()
        merged = Image.merge("HSV", (h, s.point(s_lut), v))
        return merged.convert("RGB")


@register
class Temperature(Operation):
    """Warm/cool the image. amount in [-100, 100]; positive is warmer
    (more red, less blue)."""

    label = "Temperature"

    def __init__(self, amount: float = 0):
        self.amount = amount

    def params(self):
        return {"amount": self.amount}

    def apply(self, image):
        r_factor = 1 + self.amount / 200.0
        b_factor = 1 - self.amount / 200.0
        identity = list(range(256))
        r_lut = [_clamp(v * r_factor) for v in range(256)]
        b_lut = [_clamp(v * b_factor) for v in range(256)]
        return _apply_channel_luts(image, r_lut, identity, b_lut)


@register
class Tint(Operation):
    """Green/magenta tint. amount in [-100, 100]; positive is magenta
    (less green), negative is greener."""

    label = "Tint"

    def __init__(self, amount: float = 0):
        self.amount = amount

    def params(self):
        return {"amount": self.amount}

    def apply(self, image):
        g_factor = 1 - self.amount / 200.0
        identity = list(range(256))
        g_lut = [_clamp(v * g_factor) for v in range(256)]
        return _apply_channel_luts(image, identity, g_lut, identity)


@register
class AutoWhiteBalance(Operation):
    """Gray-world white balance: scale each channel so their means match."""

    label = "Auto White Balance"

    def apply(self, image):
        means = ImageStat.Stat(image).mean[:3]
        gray = sum(means) / 3
        luts = []
        for mean in means:
            factor = 1.0 if mean == 0 else gray / mean
            luts.append([_clamp(v * factor) for v in range(256)])
        return _apply_channel_luts(image, *luts)


# --- Detail ---------------------------------------------------------------

@register
class Sharpen(Operation):
    label = "Sharpen"

    def __init__(self, factor: float = 2.0):
        self.factor = factor

    def params(self):
        return {"factor": self.factor}

    def apply(self, image):
        return ImageEnhance.Sharpness(image).enhance(self.factor)


# --- Effects --------------------------------------------------------------

@register
class Posterize(Operation):
    """Reduce each channel to `bits` bits (1-8) for a poster look."""

    label = "Posterize"

    def __init__(self, bits: int = 3):
        if not 1 <= bits <= 8:
            raise ValueError("Posterize: bits must be between 1 and 8")
        self.bits = bits

    def params(self):
        return {"bits": self.bits}

    def apply(self, image):
        return ImageOps.posterize(image, self.bits)


@register
class Solarize(Operation):
    """Invert all pixels above `threshold`."""

    label = "Solarize"

    def __init__(self, threshold: int = 128):
        self.threshold = threshold

    def params(self):
        return {"threshold": self.threshold}

    def apply(self, image):
        return ImageOps.solarize(image, self.threshold)


@register
class Vignette(Operation):
    """Darken the edges toward the corners. amount in [0, 100] strength."""

    label = "Vignette"

    def __init__(self, amount: float = 40):
        self.amount = amount

    def params(self):
        return {"amount": self.amount}

    def apply(self, image):
        strength = max(0.0, min(1.0, self.amount / 100.0))
        # radial_gradient: black (0) at center to white (255) at the corners
        gradient = Image.radial_gradient("L").resize(image.size)
        mask = gradient.point(lambda v: _clamp(v * strength))
        black = Image.new("RGB", image.size, (0, 0, 0))
        return Image.composite(black, image, mask)


# --- Geometry -------------------------------------------------------------

@register
class Crop(Operation):
    """Crop to the box (left, top, right, bottom), clamped to the image."""

    label = "Crop"

    def __init__(self, left: int, top: int, right: int, bottom: int):
        self.left = left
        self.top = top
        self.right = right
        self.bottom = bottom

    def params(self):
        return {"left": self.left, "top": self.top, "right": self.right, "bottom": self.bottom}

    def apply(self, image):
        width, height = image.size
        left = max(0, min(self.left, width - 1))
        top = max(0, min(self.top, height - 1))
        right = max(left + 1, min(self.right, width))
        bottom = max(top + 1, min(self.bottom, height))
        return image.crop((left, top, right, bottom))


@register
class Rotate(Operation):
    """Rotate by an arbitrary angle (straighten). expand keeps the whole
    rotated image; exposed corners are filled white."""

    label = "Rotate"

    def __init__(self, angle: float = 0, expand: bool = True):
        self.angle = angle
        self.expand = expand

    def params(self):
        return {"angle": self.angle, "expand": self.expand}

    def apply(self, image):
        return image.rotate(self.angle, expand=self.expand, fillcolor=(255, 255, 255))


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
