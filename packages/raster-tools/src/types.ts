/**
 * A raw RGBA pixel buffer, row-major, 8-bit per channel — the same shape as
 * `ImageData.data` but decoupled from the DOM so these algorithms are plain,
 * unit-testable functions with no canvas/browser dependency.
 */
export interface RasterImage {
  width: number;
  height: number;
  /** Length must be `width * height * 4` (RGBA, non-premultiplied). */
  data: Uint8ClampedArray;
}

/** A single-channel selection mask, one byte per pixel: 0 = unselected, 255 =
 * fully selected. Values in between represent partial (feathered) selection. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export function createImage(width: number, height: number): RasterImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneImage(image: RasterImage): RasterImage {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
  };
}

export function createMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8ClampedArray(width * height) };
}

export function pixelIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

export function inBounds(
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}
