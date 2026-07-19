import { cloneImage, type RasterImage } from "@director/raster-tools";

/**
 * DOM/canvas glue around a mutable `RasterImage` working buffer, with a
 * bounded local undo/redo stack. This is deliberately **outside** the
 * deterministic project command engine — like playback and export state —
 * so raw brush strokes never enter the operation log. A flattened result is
 * only ever committed to the project via a real `asset.register` command
 * (see `applyRasterEditToProject` in main.ts).
 */
export class RasterSession {
  image: RasterImage;
  private undoStack: RasterImage[] = [];
  private redoStack: RasterImage[] = [];
  static readonly MAX_UNDO = 25;

  constructor(image: RasterImage) {
    this.image = image;
  }

  static fromSource(
    source: CanvasImageSource,
    width: number,
    height: number,
  ): RasterSession {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(source, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    return new RasterSession({
      width,
      height,
      data: new Uint8ClampedArray(imageData.data),
    });
  }

  /** Snapshot the current buffer before a mutating operation, for undo. */
  snapshot(): void {
    this.undoStack.push(cloneImage(this.image));
    if (this.undoStack.length > RasterSession.MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(cloneImage(this.image));
    this.image = prev;
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(cloneImage(this.image));
    this.image = next;
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Resize the on-screen canvas to match the buffer and paint it. */
  drawTo(canvas: HTMLCanvasElement): void {
    canvas.width = this.image.width;
    canvas.height = this.image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(
      new ImageData(
        new Uint8ClampedArray(this.image.data),
        this.image.width,
        this.image.height,
      ),
      0,
      0,
    );
  }

  toBlob(): Promise<Blob> {
    const canvas = document.createElement("canvas");
    this.drawTo(canvas);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
        "image/png",
      );
    });
  }
}

/** Convert a canvas-space point (CSS pixels relative to the canvas element)
 * into image-buffer pixel coordinates, accounting for CSS scaling. */
export function canvasPointToImage(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}
