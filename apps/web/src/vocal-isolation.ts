/**
 * Vocal Isolation & Audio Denoising Engine.
 *
 * Implements CapCut-style audio intelligence:
 * - Isolate vocals (speech enhancement, suppressing background music/noise)
 * - Remove vocals (center-channel vocal cancellation for karaoke backing)
 * - Noise reduction (spectral noise floor suppression)
 */

export type VocalProcessingMode =
  | "isolate-vocals"
  | "remove-vocals"
  | "reduce-noise";

export interface VocalIsolationOptions {
  mode: VocalProcessingMode;
  reductionAmount?: number | undefined; // [0..1]
  noiseFloorThreshold?: number | undefined; // e.g. 0.02
}

/**
 * Applies a digital biquad bandpass filter on PCM buffer.
 */
function applyBandpassFilter(
  input: Float32Array,
  lowCutHz: number,
  highCutHz: number,
  sampleRate: number,
): Float32Array {
  const output = new Float32Array(input.length);
  // Simple high-pass followed by low-pass IIR filter approximation
  const rcLow = 1 / (2 * Math.PI * highCutHz);
  const dt = 1 / sampleRate;
  const alphaLow = dt / (rcLow + dt);

  const rcHigh = 1 / (2 * Math.PI * lowCutHz);
  const alphaHigh = rcHigh / (rcHigh + dt);

  let prevInput = 0;
  let prevHigh = 0;
  let prevLow = 0;

  for (let i = 0; i < input.length; i += 1) {
    const current = input[i] ?? 0;
    // High-pass (remove sub-300Hz rumble)
    const highPassed = alphaHigh * (prevHigh + current - prevInput);
    prevInput = current;
    prevHigh = highPassed;

    // Low-pass (remove ultra-high frequencies)
    const lowPassed = prevLow + alphaLow * (highPassed - prevLow);
    prevLow = lowPassed;

    output[i] = lowPassed;
  }

  return output;
}

/**
 * Mid-Side stereo vocal demixing. Center-panned vocals cancel out when Left - Right.
 */
export function processStereoVocalDemixing(
  leftChannel: Float32Array,
  rightChannel: Float32Array,
  mode: VocalProcessingMode,
  sampleRate = 44100,
  options: Omit<VocalIsolationOptions, "mode"> = {},
): { left: Float32Array; right: Float32Array } {
  const amount = Math.max(0, Math.min(1, options.reductionAmount ?? 0.85));
  const len = Math.min(leftChannel.length, rightChannel.length);
  const outLeft = new Float32Array(len);
  const outRight = new Float32Array(len);

  if (mode === "remove-vocals") {
    // Side component = (Left - Right) / 2
    // Removes center-panned speech/vocals
    for (let i = 0; i < len; i += 1) {
      const l = leftChannel[i] ?? 0;
      const r = rightChannel[i] ?? 0;
      const side = (l - r) * 0.5;
      outLeft[i] = l * (1 - amount) + side * amount;
      outRight[i] = r * (1 - amount) - side * amount;
    }
    return { left: outLeft, right: outRight };
  }

  if (mode === "isolate-vocals") {
    // Mid component = (Left + Right) / 2
    // Bandpass filter to human vocal range 300Hz - 3500Hz
    const mid = new Float32Array(len);
    for (let i = 0; i < len; i += 1) {
      const l = leftChannel[i] ?? 0;
      const r = rightChannel[i] ?? 0;
      mid[i] = (l + r) * 0.5;
    }
    const filteredMid = applyBandpassFilter(mid, 300, 3500, sampleRate);

    for (let i = 0; i < len; i += 1) {
      const l = leftChannel[i] ?? 0;
      const r = rightChannel[i] ?? 0;
      const vocal = filteredMid[i] ?? 0;
      outLeft[i] = l * (1 - amount) + vocal * amount;
      outRight[i] = r * (1 - amount) + vocal * amount;
    }
    return { left: outLeft, right: outRight };
  }

  // "reduce-noise": Noise floor gating
  const threshold = options.noiseFloorThreshold ?? 0.015;
  for (let i = 0; i < len; i += 1) {
    const l = leftChannel[i] ?? 0;
    const r = rightChannel[i] ?? 0;
    const mag = Math.max(Math.abs(l), Math.abs(r));
    const factor = mag < threshold ? 1 - amount : 1.0;
    outLeft[i] = l * factor;
    outRight[i] = r * factor;
  }

  return { left: outLeft, right: outRight };
}
