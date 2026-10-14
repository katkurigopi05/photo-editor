import { describe, expect, it } from "vitest";
import { processStereoVocalDemixing } from "../src/vocal-isolation.js";

describe("Vocal Isolation & Denoising Engine", () => {
  it("cancels center-panned vocals in remove-vocals mode", () => {
    // Generate identical center-panned signal (Left == Right == 0.8)
    const len = 1000;
    const left = new Float32Array(len).fill(0.8);
    const right = new Float32Array(len).fill(0.8);

    const result = processStereoVocalDemixing(left, right, "remove-vocals", 44100, {
      reductionAmount: 1.0,
    });

    // (Left - Right) should cancel out completely
    expect(result.left[100]).toBeCloseTo(0, 3);
    expect(result.right[100]).toBeCloseTo(0, 3);
  });

  it("preserves stereo-separated instruments when removing vocals", () => {
    const len = 1000;
    // Left channel has instrument sound (0.5), right is silent (0.0)
    const left = new Float32Array(len).fill(0.5);
    const right = new Float32Array(len).fill(0.0);

    const result = processStereoVocalDemixing(left, right, "remove-vocals", 44100, {
      reductionAmount: 1.0,
    });

    // Stereo side signal should survive
    expect(Math.abs(result.left[100] ?? 0)).toBeGreaterThan(0.2);
  });

  it("suppresses low-level noise floor in reduce-noise mode", () => {
    const len = 1000;
    // Signal with low noise floor (0.005) below threshold (0.015)
    const left = new Float32Array(len).fill(0.005);
    const right = new Float32Array(len).fill(0.005);

    const result = processStereoVocalDemixing(left, right, "reduce-noise", 44100, {
      reductionAmount: 0.9,
      noiseFloorThreshold: 0.015,
    });

    expect(result.left[100]).toBeLessThan(0.002);
  });
});
