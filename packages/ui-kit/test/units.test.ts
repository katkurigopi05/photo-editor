import { describe, expect, it } from "vitest";
import {
  pixelsToUs,
  pixelsToUsDelta,
  snapUsToFrame,
  usToPixels,
} from "../src/index.js";

describe("pixel <-> time", () => {
  it("converts absolute pixels to canonical microseconds", () => {
    expect(pixelsToUs(120, 120)).toBe("1000000"); // 1s at 120px/s
    expect(pixelsToUs(0, 120)).toBe("0");
  });

  it("clamps negative absolute positions to 0", () => {
    expect(pixelsToUs(-50, 120)).toBe("0");
  });

  it("round-trips through usToPixels", () => {
    expect(usToPixels("1000000", 120)).toBe(120);
  });

  it("produces signed deltas", () => {
    expect(pixelsToUsDelta(120, 120)).toBe(1_000_000n);
    expect(pixelsToUsDelta(-60, 120)).toBe(-500_000n);
  });

  it("rejects a nonpositive zoom", () => {
    expect(() => pixelsToUs(1, 0)).toThrow(RangeError);
    expect(() => pixelsToUsDelta(1, -1)).toThrow(RangeError);
  });
});

describe("snapUsToFrame", () => {
  it("snaps to the containing frame start at 30 fps", () => {
    // 40_000us is in frame 1; frame 1 starts at ceil(1e6/30) = 33_334.
    expect(snapUsToFrame("40000", { numerator: 30, denominator: 1 })).toBe(
      "33334",
    );
    expect(snapUsToFrame("0", { numerator: 30, denominator: 1 })).toBe("0");
  });
});
