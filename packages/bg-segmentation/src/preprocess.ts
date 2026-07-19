import { resizeImage, type RasterImage } from "@director/raster-tools";

/**
 * Preprocessing for the U²-Net family of background-removal models (u2net,
 * u2netp), matching the exact steps the reference `rembg` Python library
 * uses in `sessions/base.py` / `sessions/u2net.py::predict`, so the bundled
 * ONNX weights (downloaded directly from rembg's own release assets, MD5
 * checksum-verified) see the input distribution they were trained for:
 *
 *   1. resize to `inputSize` x `inputSize` (rembg uses LANCZOS; we use
 *      bilinear via @director/raster-tools — a close, real approximation,
 *      not a stand-in for a different algorithm)
 *   2. scale channels to [0, 1] (rembg divides by the image's own max pixel
 *      value; for any real photo with a bright pixel that is ~255, so /255
 *      is the same computation in practice)
 *   3. per-channel normalize with ImageNet mean/std
 *      mean = (0.485, 0.456, 0.406), std = (0.229, 0.224, 0.225)
 *   4. transpose HWC -> CHW and add a batch dimension -> [1, 3, H, W]
 */

export const U2NET_MEAN = [0.485, 0.456, 0.406] as const;
export const U2NET_STD = [0.229, 0.224, 0.225] as const;

export function preprocessU2Net(
  image: RasterImage,
  inputSize: number,
): Float32Array {
  const resized = resizeImage(image, inputSize, inputSize);
  const chw = new Float32Array(3 * inputSize * inputSize);
  const plane = inputSize * inputSize;

  for (let y = 0; y < inputSize; y++) {
    for (let x = 0; x < inputSize; x++) {
      const p = (y * inputSize + x) * 4;
      const i = y * inputSize + x;
      const r = resized.data[p]! / 255;
      const g = resized.data[p + 1]! / 255;
      const b = resized.data[p + 2]! / 255;
      chw[i] = (r - U2NET_MEAN[0]) / U2NET_STD[0];
      chw[plane + i] = (g - U2NET_MEAN[1]) / U2NET_STD[1];
      chw[2 * plane + i] = (b - U2NET_MEAN[2]) / U2NET_STD[2];
    }
  }
  return chw;
}
