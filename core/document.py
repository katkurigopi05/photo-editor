"""Non-destructive document model.

A Document holds an immutable base image plus an ordered list of Operations.
The visible image is always rendered from the base through the operation
list, so undo/redo move a pointer over that list instead of storing full
pixel snapshots — cheaper in memory and the recipe stays editable and
serializable (save_recipe / load_recipe).
"""
import json
import os

from PIL import Image

from .operations import Operation, operation_from_dict

RECIPE_VERSION = 1

RAW_EXTENSIONS = {".cr2", ".cr3", ".nef", ".arw", ".dng", ".raf", ".orf", ".rw2"}


def operations_from_recipe(path: str) -> list[Operation]:
    """Load just the operation list from a recipe JSON (used by batch export,
    which applies one recipe to many images and ignores the recipe's source)."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return [operation_from_dict(d) for d in data.get("operations", [])]


class Document:
    def __init__(self, base_image: Image.Image, source_path: str | None = None):
        self._base = base_image.convert("RGB")
        self.source_path = source_path
        self._operations: list[Operation] = []
        # Number of operations currently applied; entries beyond this index
        # are redoable until a new operation truncates them.
        self._applied = 0
        self._rendered: Image.Image | None = None

    @classmethod
    def open(cls, path: str) -> "Document":
        ext = os.path.splitext(path)[1].lower()
        if ext in RAW_EXTENSIONS:
            try:
                import rawpy
            except ImportError as e:
                raise ImportError(
                    "RAW support requires the optional 'rawpy' package. "
                    "Install it with: pip install -r requirements-raw.txt"
                ) from e
            with rawpy.imread(path) as raw:
                rgb = raw.postprocess()
            return cls(Image.fromarray(rgb), source_path=path)
        return cls(Image.open(path), source_path=path)

    # --- editing -----------------------------------------------------------

    def add_operation(self, operation: Operation) -> None:
        del self._operations[self._applied:]
        self._operations.append(operation)
        self._applied += 1
        self._rendered = None

    def undo(self) -> bool:
        if self._applied == 0:
            return False
        self._applied -= 1
        self._rendered = None
        return True

    def remove_last_operation(self) -> None:
        """Drop the most recent operation entirely (no redo), e.g. after it
        failed to render."""
        if self._applied:
            self._applied -= 1
            del self._operations[self._applied:]
            self._rendered = None

    def redo(self) -> bool:
        if self._applied == len(self._operations):
            return False
        self._applied += 1
        self._rendered = None
        return True

    @property
    def operations(self) -> list[Operation]:
        return self._operations[: self._applied]

    # --- rendering ---------------------------------------------------------

    def render(self) -> Image.Image:
        if self._rendered is None:
            image = self._base.copy()
            for operation in self.operations:
                image = operation.apply(image)
            self._rendered = image
        return self._rendered

    # --- persistence -------------------------------------------------------

    def export(self, path: str) -> None:
        """Flatten and save the rendered image as PNG or JPEG."""
        image = self.render()
        ext = os.path.splitext(path)[1].lower()
        image.save(path, format="PNG" if ext == ".png" else "JPEG")

    def save_recipe(self, path: str) -> None:
        """Save the edit recipe (not pixels) as JSON."""
        data = {
            "version": RECIPE_VERSION,
            "source": self.source_path,
            "operations": [op.to_dict() for op in self.operations],
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    @classmethod
    def load_recipe(cls, path: str) -> "Document":
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        source = data.get("source")
        if not source or not os.path.exists(source):
            raise FileNotFoundError(f"Recipe's source image not found: {source!r}")
        doc = cls.open(source)
        for op_data in data.get("operations", []):
            doc.add_operation(operation_from_dict(op_data))
        return doc
