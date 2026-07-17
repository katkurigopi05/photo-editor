"""Transformer-based background removal / segmentation.

Requires the optional 'transformers' and 'torch' packages (see
requirements-ai.txt). The import is deferred to _load_pipeline so this
module can be imported by callers that check availability first, without
requiring those packages to be installed.
"""
from PIL import Image

_pipeline_cache = {}


def _load_pipeline(model_name: str = "briaai/RMBG-1.4"):
    try:
        from transformers import pipeline
    except ImportError as e:
        raise ImportError(
            "Background removal requires the optional 'transformers' and "
            "'torch' packages. Install them with: pip install -r requirements-ai.txt"
        ) from e

    if model_name not in _pipeline_cache:
        _pipeline_cache[model_name] = pipeline("image-segmentation", model=model_name)
    return _pipeline_cache[model_name]


def remove_background(image: Image.Image, model_name: str = "briaai/RMBG-1.4") -> Image.Image:
    """Return a copy of `image` with the background removed (RGBA, background alpha=0)."""
    seg_pipeline = _load_pipeline(model_name)
    mask = seg_pipeline(image, return_mask=True)

    result = image.convert("RGBA")
    result.putalpha(mask)
    return result
