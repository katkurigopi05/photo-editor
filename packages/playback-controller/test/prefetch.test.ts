import { describe, expect, it } from "vitest";
import { planPrefetch } from "../src/index.js";
import { twoClipSequence } from "./fixtures.js";

describe("planPrefetch", () => {
  const seq = twoClipSequence(); // 30 fps, clips over [0, 2_000_000)

  it("is deterministic across calls", () => {
    const a = planPrefetch(seq, "0", "500000");
    const b = planPrefetch(seq, "0", "500000");
    expect(a).toEqual(b);
  });

  it("plans frames in the look-ahead window in order", () => {
    // 500_000 us at 30 fps -> frames 0..15 (frame 15 starts at 500000).
    const plan = planPrefetch(seq, "0", "500000");
    expect(plan[0]?.frameIndex).toBe(0);
    expect(plan.map((r) => r.frameIndex)).toEqual(
      [...plan.map((r) => r.frameIndex)].sort((x, y) => x - y),
    );
    // every request resolves to an active clip on the sequence
    for (const req of plan) {
      expect(["clip-a", "clip-b"]).toContain(req.clipId);
      expect(req.assetId).toBe(`asset-${req.clipId}`);
    }
  });

  it("carries mapped source time for each frame", () => {
    const plan = planPrefetch(seq, "1000000", "0"); // single frame at 1s
    expect(plan[0]?.clipId).toBe("clip-b");
    expect(plan[0]?.sourceTimeUs).toBe("500000");
  });

  it("rejects a negative look-ahead", () => {
    expect(() => planPrefetch(seq, "0", "-1")).toThrow(RangeError);
  });
});
