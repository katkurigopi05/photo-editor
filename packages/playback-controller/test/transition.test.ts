import { describe, expect, it } from "vitest";
import type { Transition } from "@director/project-schema";
import { sampleClipTransition } from "../src/transition.js";

const DUR = "4000000"; // 4s clip

const linearIn: Transition = {
  id: "in",
  kind: "cross",
  durationUs: "1000000",
  easing: "linear",
};
const linearOut: Transition = {
  id: "out",
  kind: "cross",
  durationUs: "1000000",
  easing: "linear",
};

const clip = (
  transitionIn?: Transition,
  transitionOut?: Transition,
): Parameters<typeof sampleClipTransition>[0] => ({
  timelineDurationUs: DUR,
  ...(transitionIn === undefined ? {} : { transitionIn }),
  ...(transitionOut === undefined ? {} : { transitionOut }),
});

describe("sampleClipTransition", () => {
  it("is fully opaque when the clip has no transitions", () => {
    expect(sampleClipTransition(clip(), "0").opacity).toBe(1);
    expect(sampleClipTransition(clip(), "2000000").opacity).toBe(1);
  });

  it("ramps an incoming transition from 0 to 1 across its window", () => {
    const c = clip(linearIn);
    expect(sampleClipTransition(c, "0").opacity).toBe(0);
    expect(sampleClipTransition(c, "250000").opacity).toBeCloseTo(0.25, 9);
    expect(sampleClipTransition(c, "500000").opacity).toBeCloseTo(0.5, 9);
    expect(sampleClipTransition(c, "1000000").opacity).toBe(1);
  });

  it("holds full opacity after the incoming window closes", () => {
    const c = clip(linearIn);
    expect(sampleClipTransition(c, "1000001").opacity).toBe(1);
    expect(sampleClipTransition(c, "3999999").opacity).toBe(1);
  });

  it("ramps an outgoing transition from 1 down to 0 at the clip end", () => {
    const c = clip(undefined, linearOut);
    // Window is the last 1s: [3000000, 4000000)
    expect(sampleClipTransition(c, "2999999").opacity).toBe(1);
    expect(sampleClipTransition(c, "3000000").opacity).toBeCloseTo(1, 9);
    expect(sampleClipTransition(c, "3500000").opacity).toBeCloseTo(0.5, 9);
    expect(sampleClipTransition(c, "3750000").opacity).toBeCloseTo(0.25, 9);
  });

  it("applies both ramps on a clip that fades in and out", () => {
    const c = clip(linearIn, linearOut);
    expect(sampleClipTransition(c, "0").opacity).toBe(0);
    expect(sampleClipTransition(c, "500000").opacity).toBeCloseTo(0.5, 9);
    expect(sampleClipTransition(c, "2000000").opacity).toBe(1);
    expect(sampleClipTransition(c, "3500000").opacity).toBeCloseTo(0.5, 9);
  });

  it("honours the easing curve rather than assuming linear", () => {
    const eased = sampleClipTransition(
      clip({ ...linearIn, easing: "ease-in-out" }),
      "500000",
    ).opacity;
    // ease-in-out is symmetric: exactly 0.5 at the midpoint, but it must not
    // match linear away from it.
    expect(eased).toBeCloseTo(0.5, 6);
    const quarter = sampleClipTransition(
      clip({ ...linearIn, easing: "ease-in-out" }),
      "250000",
    ).opacity;
    expect(quarter).toBeLessThan(0.25);
  });

  it("reports the dip colour only while a dip window is active", () => {
    const dip: Transition = {
      id: "d",
      kind: "dip",
      durationUs: "1000000",
      easing: "linear",
      colorHex: "#ff0000",
    };
    const c = clip(dip);
    expect(sampleClipTransition(c, "500000").dipColorHex).toBe("#ff0000");
    // Outside the window there is nothing to paint.
    expect(sampleClipTransition(c, "2000000").dipColorHex).toBeUndefined();
  });

  it("reports no dip colour for a crossfade", () => {
    expect(sampleClipTransition(clip(linearIn), "500000").dipColorHex).toBe(
      undefined,
    );
  });

  it("multiplies overlapping in and out ramps that exactly meet", () => {
    // in and out each 2s on a 4s clip: they touch at the midpoint and the
    // opacity must not exceed 1 or go negative anywhere.
    const c = clip(
      { ...linearIn, durationUs: "2000000" },
      { ...linearOut, durationUs: "2000000" },
    );
    for (let t = 0; t < 4_000_000; t += 100_000) {
      const o = sampleClipTransition(c, String(t)).opacity;
      expect(o, `t=${t}`).toBeGreaterThanOrEqual(0);
      expect(o, `t=${t}`).toBeLessThanOrEqual(1);
    }
    expect(sampleClipTransition(c, "2000000").opacity).toBeCloseTo(1, 9);
  });

  it("uses BigInt time so large timelines keep exact windows", () => {
    const c = {
      timelineDurationUs: "9007199254740993000",
      transitionIn: { ...linearIn, durationUs: "9007199254740992000" },
    };
    expect(sampleClipTransition(c, "9007199254740992000").opacity).toBe(1);
  });

  it("rejects negative clip-local time", () => {
    expect(() => sampleClipTransition(clip(linearIn), "-1")).toThrow(
      RangeError,
    );
  });
});
