import { describe, expect, it } from "vitest";
import {
  applyColorMatch,
  computeImageColorStats,
} from "../src/color-match.js";

function makeImageData(
  rgbaValues: number[],
  width = 1,
  height = 1,
): ImageData {
  const data = new Uint8ClampedArray(rgbaValues);
  return { data, width, height } as unknown as ImageData;
}

describe("AI Color Match Engine", () => {
  it("computes per-channel mean and standard deviation accurately", () => {
    // 2 pixels: red [200, 50, 50, 255] and green [50, 200, 50, 255]
    const img = makeImageData(
      [200, 50, 50, 255, 50, 200, 50, 255],
      2,
      1,
    );

    const stats = computeImageColorStats(img);
    expect(stats.r.mean).toBe(125);
    expect(stats.g.mean).toBe(125);
    expect(stats.b.mean).toBe(50);
    expect(stats.r.stdDev).toBeCloseTo(75, 1);
  });

  it("transfers color statistics from reference to target", () => {
    // Reference: warm tint (R: 200, G: 120, B: 50)
    const refImg = makeImageData(
      [200, 120, 50, 255, 210, 130, 60, 255],
      2,
      1,
    );
    const refStats = computeImageColorStats(refImg);

    // Target: cool tint (R: 50, G: 100, B: 200)
    const tgtImg = makeImageData(
      [50, 100, 200, 255, 60, 110, 210, 255],
      2,
      1,
    );

    const matched = applyColorMatch(tgtImg, refStats, { intensity: 1.0 });

    const matchedStats = computeImageColorStats(matched);
    // After matching, target should have shifted toward reference means
    expect(matchedStats.r.mean).toBeGreaterThan(150);
    expect(matchedStats.b.mean).toBeLessThan(100);
    // Alpha channel preserved
    expect(matched.data[3]).toBe(255);
  });

  it("respects intensity blending parameter", () => {
    const refImg = makeImageData([255, 255, 255, 255]);
    const refStats = computeImageColorStats(refImg);

    // Dark target
    const tgtImg = makeImageData([0, 0, 0, 255]);

    const halfMatch = applyColorMatch(tgtImg, refStats, { intensity: 0.5 });
    // Channel values should be midway between 0 and 255 (~128)
    expect(halfMatch.data[0]).toBeGreaterThan(60);
    expect(halfMatch.data[0]).toBeLessThan(200);

    const zeroMatch = applyColorMatch(tgtImg, refStats, { intensity: 0.0 });
    expect(zeroMatch.data[0]).toBe(0);
  });
});
