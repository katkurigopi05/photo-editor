/**
 * Video Deflicker & Exposure Stabilization Engine.
 *
 * Implements CapCut-style AI deflickering:
 * - Detects frame-to-frame luminance fluctuations (LED flicker, time-lapse shutter jitter)
 * - Computes temporal moving average baseline
 * - Normalizes frame exposure gains to eliminate strobe flicker
 */

function createImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ImageData {
  if (typeof ImageData !== "undefined") {
    return new ImageData(
      data as unknown as Uint8ClampedArray<ArrayBuffer>,
      width,
      height,
    );
  }
  return { data, width, height } as unknown as ImageData;
}

/**
 * Calculates mean perceptual luminance of an image frame.
 */
export function calculateFrameLuminance(frame: ImageData): number {
  const pixels = frame.data;
  const count = pixels.length / 4;
  if (count === 0) return 0;

  let totalLum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    totalLum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  return totalLum / count;
}

/**
 * Computes smooth temporal luminance baseline using a moving average window.
 */
export function computeSmoothedLuminanceTimeline(
  frameLuminances: readonly number[],
  windowRadius = 3,
): number[] {
  const count = frameLuminances.length;
  if (count === 0) return [];
  const smoothed: number[] = [];

  for (let i = 0; i < count; i += 1) {
    const start = Math.max(0, i - windowRadius);
    const end = Math.min(count - 1, i + windowRadius);
    let sum = 0;
    let windowLen = 0;

    for (let j = start; j <= end; j += 1) {
      sum += frameLuminances[j] ?? 0;
      windowLen += 1;
    }

    smoothed.push(windowLen > 0 ? sum / windowLen : frameLuminances[i] ?? 0);
  }

  return smoothed;
}

/**
 * Calculates exposure normalization gain for a single frame.
 */
export function calculateDeflickerGain(
  measuredLuminance: number,
  targetLuminance: number,
  maxGainAdjustment = 2.0, // Limits extreme amplification of black frames
): number {
  if (measuredLuminance <= 0.001) return 1.0;
  const rawGain = targetLuminance / measuredLuminance;
  const minGain = 1 / maxGainAdjustment;
  return Math.max(minGain, Math.min(maxGainAdjustment, rawGain));
}

/**
 * Applies deflicker gain compensation to an ImageData frame.
 */
export function applyDeflickerGain(frame: ImageData, gain: number): ImageData {
  const result = createImageData(
    new Uint8ClampedArray(frame.data),
    frame.width,
    frame.height,
  );
  if (Math.abs(gain - 1.0) < 0.001) return result;

  const pixels = result.data;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = Math.round((pixels[i] ?? 0) * gain);
    pixels[i + 1] = Math.round((pixels[i + 1] ?? 0) * gain);
    pixels[i + 2] = Math.round((pixels[i + 2] ?? 0) * gain);
  }

  return result;
}
