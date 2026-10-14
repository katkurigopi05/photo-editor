/**
 * Lightroom-inspired Upright & Perspective Geometry Engine.
 *
 * Implements 3x3 projective homography transformation for keystone correction,
 * vertical tilt, horizontal yaw, rotation, scale, aspect squeeze, and offset.
 */

export interface PerspectiveUprightOptions {
  /** Vertical perspective tilt [-100, 100]. */
  vertical?: number;
  /** Horizontal perspective yaw [-100, 100]. */
  horizontal?: number;
  /** Rotation angle in degrees [-45, 45]. */
  rotate?: number;
  /** Scale percentage [50, 200] (default: 100). */
  scale?: number;
  /** Aspect ratio squeeze/stretch [-100, 100] (default: 0). */
  aspect?: number;
  /** Horizontal translation offset [-100, 100] percent of width. */
  offsetX?: number;
  /** Vertical translation offset [-100, 100] percent of height. */
  offsetY?: number;
}

function createImageData(width: number, height: number, data?: Uint8ClampedArray): ImageData {
  const pixelData = data ?? new Uint8ClampedArray(width * height * 4);
  if (typeof ImageData !== "undefined") {
    return new ImageData(pixelData as unknown as Uint8ClampedArray<ArrayBuffer>, width, height);
  }
  return { data: pixelData, width, height } as unknown as ImageData;
}

/**
 * Bilinear sampling from image data at continuous coordinates (x, y).
 * Returns transparent black if coordinate is out of bounds.
 */
function sampleBilinearSafe(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  if (x < 0 || x >= width - 1 || y < 0 || y >= height - 1) {
    if (x < -1 || x > width || y < -1 || y > height) {
      return [0, 0, 0, 0];
    }
    // Edge clamping within 1 pixel
    const cx = Math.max(0, Math.min(width - 1, x));
    const cy = Math.max(0, Math.min(height - 1, y));
    const idx = (Math.round(cy) * width + Math.round(cx)) * 4;
    return [data[idx] ?? 0, data[idx + 1] ?? 0, data[idx + 2] ?? 0, data[idx + 3] ?? 0];
  }

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const fx = x - x0;
  const fy = y - y0;

  const idx00 = (y0 * width + x0) * 4;
  const idx10 = (y0 * width + x1) * 4;
  const idx01 = (y1 * width + x0) * 4;
  const idx11 = (y1 * width + x1) * 4;

  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;

  const r = (data[idx00] ?? 0) * w00 + (data[idx10] ?? 0) * w10 + (data[idx01] ?? 0) * w01 + (data[idx11] ?? 0) * w11;
  const g = (data[idx00 + 1] ?? 0) * w00 + (data[idx10 + 1] ?? 0) * w10 + (data[idx01 + 1] ?? 0) * w01 + (data[idx11 + 1] ?? 0) * w11;
  const b = (data[idx00 + 2] ?? 0) * w00 + (data[idx10 + 2] ?? 0) * w10 + (data[idx01 + 2] ?? 0) * w01 + (data[idx11 + 2] ?? 0) * w11;
  const a = (data[idx00 + 3] ?? 0) * w00 + (data[idx10 + 3] ?? 0) * w10 + (data[idx01 + 3] ?? 0) * w01 + (data[idx11 + 3] ?? 0) * w11;

  return [Math.round(r), Math.round(g), Math.round(b), Math.round(a)];
}

type Mat3 = [number, number, number, number, number, number, number, number, number];

/**
 * 3x3 Matrix Inversion for Homography.
 */
function invert3x3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;

  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-9) return null;

  const invDet = 1 / det;
  return [
    A * invDet, D * invDet, G * invDet,
    B * invDet, E * invDet, H * invDet,
    C * invDet, F * invDet, I * invDet,
  ];
}

/**
 * Multiplies two 3x3 matrices.
 */
function multiply3x3(a: Mat3, b: Mat3): Mat3 {
  const result: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        sum += (a[row * 3 + k] ?? 0) * (b[k * 3 + col] ?? 0);
      }
      result[row * 3 + col] = sum;
    }
  }
  return result;
}

/**
 * Transforms an image using projective homography geometry parameters.
 */
export function applyPerspectiveUpright(
  image: ImageData,
  options: PerspectiveUprightOptions = {},
): ImageData {
  const {
    vertical = 0,
    horizontal = 0,
    rotate = 0,
    scale = 100,
    aspect = 0,
    offsetX = 0,
    offsetY = 0,
  } = options;

  const isIdentity =
    vertical === 0 &&
    horizontal === 0 &&
    rotate === 0 &&
    scale === 100 &&
    aspect === 0 &&
    offsetX === 0 &&
    offsetY === 0;

  if (isIdentity) {
    const copy = new Uint8ClampedArray(image.data);
    return createImageData(image.width, image.height, copy);
  }

  const { width, height, data } = image;
  const output = createImageData(width, height);
  const outData = output.data;

  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;

  // Build composite forward transformation matrix: T_center * Homography * S * R * T_origin
  const s = Math.max(0.1, scale / 100);
  const aspectFactor = Math.pow(2, aspect / 100); // 1 = normal, >1 stretch width, <1 stretch height
  const sx = s * aspectFactor;
  const sy = s / aspectFactor;

  const rad = (rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Keystone projective terms:
  // pX controls horizontal vanishing line slope (yaw)
  // pY controls vertical vanishing line slope (pitch)
  const pY = (-vertical / 100) * (0.0015 / (height / 200));
  const pX = (-horizontal / 100) * (0.0015 / (width / 200));

  const tx = (offsetX / 100) * width;
  const ty = (offsetY / 100) * height;

  // Translate to origin (-cx, -cy)
  const T_pre: Mat3 = [
    1, 0, -cx,
    0, 1, -cy,
    0, 0, 1,
  ];

  // Rotate & Scale
  const RS: Mat3 = [
    cos * sx, -sin * sy, tx,
    sin * sx, cos * sy, ty,
    0, 0, 1,
  ];

  // Projective keystone
  const P: Mat3 = [
    1, 0, 0,
    0, 1, 0,
    pX, pY, 1,
  ];

  // Translate back (+cx, +cy)
  const T_post: Mat3 = [
    1, 0, cx,
    0, 1, cy,
    0, 0, 1,
  ];

  // H_forward = T_post * P * RS * T_pre
  const M1 = multiply3x3(RS, T_pre);
  const M2 = multiply3x3(P, M1);
  const H_forward = multiply3x3(T_post, M2);

  // We sample backward: H_inv maps destination (x, y) to source (xs, ys)
  const H_inv = invert3x3(H_forward);
  if (!H_inv) {
    const copy = new Uint8ClampedArray(image.data);
    return createImageData(width, height, copy);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const outIdx = (y * width + x) * 4;

      // Projective transform: (xs, ys, w) = H_inv * (x, y, 1)
      const w = H_inv[6] * x + H_inv[7] * y + H_inv[8];
      if (Math.abs(w) < 1e-7) {
        continue;
      }
      const xs = (H_inv[0] * x + H_inv[1] * y + H_inv[2]) / w;
      const ys = (H_inv[3] * x + H_inv[4] * y + H_inv[5]) / w;

      const [r, g, b, a] = sampleBilinearSafe(data, width, height, xs, ys);

      outData[outIdx] = r;
      outData[outIdx + 1] = g;
      outData[outIdx + 2] = b;
      outData[outIdx + 3] = a;
    }
  }

  return output;
}
