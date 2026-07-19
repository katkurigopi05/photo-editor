import { createImage, resizeImage, type Mask } from "@director/raster-tools";

/**
 * Postprocessing matching rembg's `u2net.py::predict`:
 *   1. take the model's single-channel output
 *   2. min-max normalize over the whole array, clip to [0, 1]
 *   3. scale to [0, 255] as an 8-bit mask
 *   4. resize back to the original image dimensions
 */
export function postprocessU2Net(
  output: Float32Array,
  inputSize: number,
  targetWidth: number,
  targetHeight: number,
): Mask {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < output.length; i++) {
    const v = output[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1e-6;

  // Pack the normalized mask into a grayscale RGBA image so we can reuse the
  // existing bilinear resizeImage() rather than writing a second resampler.
  const packed = createImage(inputSize, inputSize);
  for (let i = 0; i < output.length; i++) {
    const normalized = Math.max(0, Math.min(1, (output[i]! - min) / range));
    const byte = Math.round(normalized * 255);
    const p = i * 4;
    packed.data[p] = byte;
    packed.data[p + 1] = byte;
    packed.data[p + 2] = byte;
    packed.data[p + 3] = 255;
  }

  const resized = resizeImage(packed, targetWidth, targetHeight);
  const mask: Mask = {
    width: targetWidth,
    height: targetHeight,
    data: new Uint8ClampedArray(targetWidth * targetHeight),
  };
  for (let i = 0; i < mask.data.length; i++) {
    mask.data[i] = resized.data[i * 4]!;
  }
  return mask;
}
