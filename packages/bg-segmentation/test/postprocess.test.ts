import { describe, expect, it } from "vitest";
import { postprocessU2Net } from "../src/postprocess.js";

describe("postprocessU2Net", () => {
  it("min-max normalizes and resizes to the target dimensions", () => {
    const size = 4;
    const output = new Float32Array(size * size);
    // Half low, half high — a clean synthetic "prediction".
    for (let i = 0; i < output.length; i++) {
      output[i] = i < output.length / 2 ? 0.1 : 0.9;
    }
    const mask = postprocessU2Net(output, size, 8, 8);
    expect(mask.width).toBe(8);
    expect(mask.height).toBe(8);
    // The low region should end up near 0 and the high region near 255
    // after min-max normalization (0.1 -> min -> 0, 0.9 -> max -> 255).
    expect(mask.data[0]).toBeLessThan(50);
    expect(mask.data[mask.data.length - 1]).toBeGreaterThan(200);
  });

  it("handles a uniform (zero-range) prediction without NaN/crash", () => {
    const output = new Float32Array(4 * 4).fill(0.5);
    const mask = postprocessU2Net(output, 4, 4, 4);
    expect(mask.data.every((v) => Number.isFinite(v))).toBe(true);
  });
});
