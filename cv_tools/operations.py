"""OpenCV-backed Operations that plug into the core registry.

These provide capabilities Pillow doesn't do well: adaptive local contrast
(CLAHE), edge-preserving denoise, and classical inpainting-based object
removal. Importing this module is cheap and safe without OpenCV installed —
cv2/numpy are only imported inside apply(), via cv_tools.conversions.
"""
from core.operations import Operation, register

from .conversions import cv_to_pil, pil_to_cv, require_cv


@register
class CLAHE(Operation):
    """Contrast Limited Adaptive Histogram Equalization on the L channel of
    LAB — boosts local contrast without blowing out global tones."""

    label = "CLAHE (local contrast)"

    def __init__(self, clip_limit: float = 2.0, tile_grid: int = 8):
        self.clip_limit = clip_limit
        self.tile_grid = tile_grid

    def params(self):
        return {"clip_limit": self.clip_limit, "tile_grid": self.tile_grid}

    def apply(self, image):
        cv2, _ = require_cv()
        bgr = pil_to_cv(image)
        lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(
            clipLimit=self.clip_limit,
            tileGridSize=(self.tile_grid, self.tile_grid),
        )
        merged = cv2.merge((clahe.apply(l), a, b))
        return cv_to_pil(cv2.cvtColor(merged, cv2.COLOR_LAB2BGR))


@register
class Denoise(Operation):
    """Non-local means colored denoising — removes noise while keeping edges."""

    label = "Denoise"

    def __init__(self, strength: float = 10, color_strength: float = 10):
        self.strength = strength
        self.color_strength = color_strength

    def params(self):
        return {"strength": self.strength, "color_strength": self.color_strength}

    def apply(self, image):
        cv2, _ = require_cv()
        bgr = pil_to_cv(image)
        out = cv2.fastNlMeansDenoisingColored(
            bgr, None, float(self.strength), float(self.color_strength), 7, 21
        )
        return cv_to_pil(out)


@register
class BilateralFilter(Operation):
    """Edge-preserving smoothing (skin-smoothing / poster-like flattening)."""

    label = "Bilateral Smooth"

    def __init__(self, diameter: int = 9, sigma_color: float = 75, sigma_space: float = 75):
        self.diameter = diameter
        self.sigma_color = sigma_color
        self.sigma_space = sigma_space

    def params(self):
        return {
            "diameter": self.diameter,
            "sigma_color": self.sigma_color,
            "sigma_space": self.sigma_space,
        }

    def apply(self, image):
        cv2, _ = require_cv()
        bgr = pil_to_cv(image)
        out = cv2.bilateralFilter(bgr, self.diameter, self.sigma_color, self.sigma_space)
        return cv_to_pil(out)


@register
class UnsharpMask(Operation):
    """Unsharp masking with fine control: sharpened = image + amount*(image - blur)."""

    label = "Unsharp Mask"

    def __init__(self, radius: float = 2.0, amount: float = 1.0):
        self.radius = radius
        self.amount = amount

    def params(self):
        return {"radius": self.radius, "amount": self.amount}

    def apply(self, image):
        cv2, np = require_cv()
        bgr = pil_to_cv(image).astype(np.float32)
        blurred = cv2.GaussianBlur(bgr, (0, 0), self.radius)
        sharpened = bgr + self.amount * (bgr - blurred)
        sharpened = np.clip(sharpened, 0, 255).astype(np.uint8)
        return cv_to_pil(sharpened)


@register
class RemoveObject(Operation):
    """Classical (non-ML) object removal: inpaint a rectangular or elliptical
    region from surrounding pixels — like a healing/remove tool for small
    distractions."""

    label = "Remove Object (inpaint)"

    def __init__(self, left, top, right, bottom, shape: str = "rectangle",
                 radius: int = 3, method: str = "telea"):
        if shape not in ("rectangle", "ellipse"):
            raise ValueError(f"Unknown shape: {shape!r}")
        if method not in ("telea", "ns"):
            raise ValueError(f"Unknown inpaint method: {method!r}")
        self.left = left
        self.top = top
        self.right = right
        self.bottom = bottom
        self.shape = shape
        self.radius = radius
        self.method = method

    def params(self):
        return {
            "left": self.left, "top": self.top,
            "right": self.right, "bottom": self.bottom,
            "shape": self.shape, "radius": self.radius, "method": self.method,
        }

    def apply(self, image):
        cv2, np = require_cv()
        bgr = pil_to_cv(image)
        height, width = bgr.shape[:2]
        mask = np.zeros((height, width), dtype=np.uint8)
        box = (int(self.left), int(self.top), int(self.right), int(self.bottom))
        if self.shape == "ellipse":
            center = ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2)
            axes = (max(1, (box[2] - box[0]) // 2), max(1, (box[3] - box[1]) // 2))
            cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1)
        else:
            cv2.rectangle(mask, (box[0], box[1]), (box[2], box[3]), 255, -1)
        flag = cv2.INPAINT_TELEA if self.method == "telea" else cv2.INPAINT_NS
        out = cv2.inpaint(bgr, mask, self.radius, flag)
        return cv_to_pil(out)
