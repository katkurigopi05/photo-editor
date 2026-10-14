import { describe, expect, it } from "vitest";
import {
  applyDeflickerGain,
  calculateDeflickerGain,
  calculateFrameLuminance,
  computeSmoothedLuminanceTimeline,
} from "../src/deflicker.js";

function makeImageData(
  rgbaValues: number[],
  width = 1,
  height = 1,
): ImageData {
  const data = new Uint8ClampedArray(rgbaValues);
  return { data, width, height } as unknown as ImageData;
}

describe("Video Deflicker Engine", () => {
  it("calculates accurate perceptual frame luminance", () => {
    // Pure green is highest luminance (0.7152), pure blue is lowest (0.0722)
    const greenFrame = makeImageData([0, 255, 0, 255]);
    const blueFrame = makeImageData([0, 0, 255, 255]);

    const greenLum = calculateFrameLuminance(greenFrame);
    const blueLum = calculateFrameLuminance(blueFrame);

    expect(greenLum).toBeCloseTo(182.37, 1);
    expect(blueLum).toBeCloseTo(18.41, 1);
  });

  it("smooths erratic flickering luminance sequence using moving average", () => {
    // Alternating exposure flicker: 100, 150, 100, 150, 100
    const fluctuating = [100, 150, 100, 150, 100];
    const smoothed = computeSmoothedLuminanceTimeline(fluctuating, 1);

    // Midpoints should be smoothed toward 125
    expect(smoothed[1]).toBeCloseTo(116.6, 0.5);
    expect(smoothed[2]).toBeCloseTo(133.3, 0.5);
  });

  it("calculates gain factor bounded by maxGainAdjustment", () => {
    const normalGain = calculateDeflickerGain(100, 120);
    expect(normalGain).toBe(1.2);

    // Extreme dark frame compensation capped at max
    const extremeGain = calculateDeflickerGain(10, 100, 2.0);
    expect(extremeGain).toBe(2.0);
  });

  it("applies exposure compensation gain to pixel data", () => {
    const frame = makeImageData([50, 50, 50, 255]);
    const compensated = applyDeflickerGain(frame, 1.5);

    expect(compensated.data[0]).toBe(75);
    expect(compensated.data[1]).toBe(75);
    expect(compensated.data[2]).toBe(75);
    expect(compensated.data[3]).toBe(255); // Alpha preserved
  });
});
