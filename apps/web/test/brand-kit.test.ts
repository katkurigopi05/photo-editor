import { describe, expect, it } from "vitest";
import {
  calculateContrastRatio,
  createDefaultBrandKit,
  generateColorHarmonies,
  getRelativeLuminance,
  shufflePalette,
} from "../src/brand-kit.js";

describe("Smart Brand Kits & Color Harmonies", () => {
  it("calculates relative luminance accurately", () => {
    // Pure black is 0, pure white is 1
    expect(getRelativeLuminance("#000000")).toBe(0);
    expect(getRelativeLuminance("#ffffff")).toBeCloseTo(1, 2);
  });

  it("calculates WCAG 2.2 contrast ratio and checks compliance", () => {
    // Black text on white background -> 21:1 ratio
    const highContrast = calculateContrastRatio("#000000", "#ffffff");
    expect(highContrast.ratio).toBe(21);
    expect(highContrast.isNormalTextAA).toBe(true);
    expect(highContrast.isNormalTextAAA).toBe(true);

    // Light gray on white -> very low contrast, fails AA
    const lowContrast = calculateContrastRatio("#cccccc", "#ffffff");
    expect(lowContrast.ratio).toBeLessThan(4.5);
    expect(lowContrast.isNormalTextAA).toBe(false);
  });

  it("generates harmonic color sets (complementary, triadic, etc.)", () => {
    const harmonies = generateColorHarmonies("#0066cc");
    expect(harmonies.length).toBe(5);

    const complementary = harmonies.find((h) => h.type === "complementary");
    expect(complementary).toBeDefined();
    expect(complementary?.colors.length).toBe(2);

    const triadic = harmonies.find((h) => h.type === "triadic");
    expect(triadic).toBeDefined();
    expect(triadic?.colors.length).toBe(3);
  });

  it("creates a well-formed default brand kit", () => {
    const kit = createDefaultBrandKit("Acme Corp", "#0055ff");
    expect(kit.name).toBe("Acme Corp");
    expect(kit.palette.primary).toBe("#0055ff");
    expect(kit.palette.secondary).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(kit.typography.headingFont).toBeDefined();
    expect(kit.logos).toEqual([]);
  });

  it("shuffles palette deterministically for multi-element layouts", () => {
    const kit = createDefaultBrandKit("Brand", "#ff4400");
    const set1 = shufflePalette(kit.palette, 4, 1);
    const set2 = shufflePalette(kit.palette, 4, 2);

    expect(set1.length).toBe(4);
    expect(set2.length).toBe(4);
    expect(set1).not.toEqual(set2);
  });

  it("handles shorthand 3-digit hex strings", () => {
    const whiteRatio = calculateContrastRatio("#000", "#fff");
    expect(whiteRatio.ratio).toBe(21);
  });
});
