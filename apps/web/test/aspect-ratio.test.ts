import { describe, expect, it } from "vitest";
import {
  ASPECT_PRESETS,
  calculateReflowTransform,
  findClosestPreset,
  getPresetById,
} from "../src/aspect-ratio.js";

describe("Magic Aspect Ratio & Social Presets", () => {
  it("provides comprehensive standard presets for social, video, and print", () => {
    expect(ASPECT_PRESETS.length).toBeGreaterThanOrEqual(10);
    const igSquare = getPresetById("ig-square");
    expect(igSquare).toBeDefined();
    expect(igSquare?.width).toBe(1080);
    expect(igSquare?.height).toBe(1080);

    const tiktok = getPresetById("story-reel-tiktok");
    expect(tiktok?.safeMargin).toBeDefined();
    expect(tiktok?.safeMargin?.top).toBe(0.12);
  });

  it("calculates contain reflow coordinates with letterboxing/pillarboxing", () => {
    // 1920x1080 (16:9) into 1080x1080 (1:1) -> width fits, height pillarboxed
    const result = calculateReflowTransform(1920, 1080, 1080, 1080, "contain");
    expect(result.width).toBe(1080);
    // height = 1080 * (1080/1920) = 608
    expect(result.height).toBe(608);
    expect(result.x).toBe(0);
    expect(result.y).toBe((1080 - 608) / 2); // Centered
  });

  it("calculates cover reflow coordinates with center cropping", () => {
    // 1920x1080 (16:9) into 1080x1920 (9:16)
    const result = calculateReflowTransform(1920, 1080, 1080, 1920, "cover");
    expect(result.height).toBe(1920);
    expect(result.width).toBeGreaterThanOrEqual(1080);
    expect(result.scaleX).toBe(1920 / 1080);
    expect(result.x).toBeLessThan(0); // overflow centered
  });

  it("calculates stretch fit exactly", () => {
    const result = calculateReflowTransform(1920, 1080, 1080, 1080, "stretch");
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1080);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it("calculates safe-fit respecting mobile UI safe margins", () => {
    const tiktok = getPresetById("story-reel-tiktok")!;
    const result = calculateReflowTransform(
      1920,
      1080,
      1080,
      1920,
      "safe-fit",
      tiktok.safeMargin,
    );
    // Margins should be added to offset
    expect(result.x).toBeGreaterThanOrEqual(1080 * tiktok.safeMargin!.left);
    expect(result.y).toBeGreaterThanOrEqual(1920 * tiktok.safeMargin!.top);
  });

  it("throws error for non-positive dimensions", () => {
    expect(() => calculateReflowTransform(0, 100, 100, 100)).toThrow();
    expect(() => calculateReflowTransform(100, -10, 100, 100)).toThrow();
  });

  it("finds closest presets accurately based on aspect ratio", () => {
    const squareMatch = findClosestPreset(500, 500);
    expect(squareMatch?.id).toBe("ig-square");

    const verticalMatch = findClosestPreset(720, 1280);
    expect(verticalMatch?.id).toBe("story-reel-tiktok");

    expect(findClosestPreset(-1, 100)).toBeUndefined();
  });
});
