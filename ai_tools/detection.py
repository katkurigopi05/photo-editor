"""YOLO-based object detection for "smart select" and auto-crop.

Requires the optional 'ultralytics' package (see requirements-ai.txt).
The import is deferred to _load_model so this module can be imported by
callers that check availability first, without requiring ultralytics to
be installed.
"""
from dataclasses import dataclass
from typing import List, Tuple

_model_cache = {}


@dataclass
class Detection:
    label: str
    confidence: float
    box: Tuple[float, float, float, float]  # (x1, y1, x2, y2)


def _load_model(weights: str = "yolov8n.pt"):
    try:
        from ultralytics import YOLO
    except ImportError as e:
        raise ImportError(
            "Object detection requires the optional 'ultralytics' package. "
            "Install it with: pip install -r requirements-ai.txt"
        ) from e

    if weights not in _model_cache:
        _model_cache[weights] = YOLO(weights)
    return _model_cache[weights]


def detect_objects(image, weights: str = "yolov8n.pt", confidence: float = 0.25) -> List[Detection]:
    """Run YOLO object detection on a PIL image and return bounding boxes."""
    model = _load_model(weights)
    results = model.predict(image, conf=confidence, verbose=False)[0]

    detections = []
    for box in results.boxes:
        x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
        label = results.names[int(box.cls[0])]
        conf = float(box.conf[0])
        detections.append(Detection(label=label, confidence=conf, box=(x1, y1, x2, y2)))
    return detections
