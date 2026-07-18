import { describe, expect, it } from "vitest";
import { resolveAtTime, sequenceDurationUs } from "../src/index.js";
import { twoClipSequence } from "./fixtures.js";

describe("resolveAtTime", () => {
  const seq = twoClipSequence();

  it("resolves the active clip and maps source time 1:1 (v1 rate)", () => {
    const at = resolveAtTime(seq, "250000");
    expect(at).toHaveLength(1);
    expect(at[0]?.clipId).toBe("clip-a");
    expect(at[0]?.sourceTimeUs).toBe("250000");
  });

  it("honors half-open ranges at the boundary", () => {
    // t = 1_000_000 is the END of clip-a (excluded) and START of clip-b.
    const at = resolveAtTime(seq, "1000000");
    expect(at[0]?.clipId).toBe("clip-b");
    // clip-b sourceIn is 500_000, offset 0.
    expect(at[0]?.sourceTimeUs).toBe("500000");
  });

  it("maps source time with the clip's sourceIn offset", () => {
    const at = resolveAtTime(seq, "1500000");
    expect(at[0]?.clipId).toBe("clip-b");
    expect(at[0]?.sourceTimeUs).toBe("1000000"); // 500000 + 500000
  });

  it("returns no active clip in a gap / past the end", () => {
    expect(resolveAtTime(seq, "2000000")).toEqual([]);
  });
});

describe("sequenceDurationUs", () => {
  it("is the end of the last clip", () => {
    expect(sequenceDurationUs(twoClipSequence())).toBe("2000000");
  });

  it("is 0 for an empty sequence", () => {
    expect(
      sequenceDurationUs({
        id: "s",
        name: "n",
        width: 1,
        height: 1,
        frameRate: { numerator: 30, denominator: 1 },
        tracks: [],
      }),
    ).toBe("0");
  });
});
