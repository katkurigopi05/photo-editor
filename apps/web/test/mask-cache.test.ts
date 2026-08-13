import { beforeEach, describe, expect, it } from "vitest";
import type { ClipMask } from "@director/project-schema";
import {
  geometricCoverage,
  maskCoverageStats,
  maskIsGeometric,
  resetMaskCoverageCache,
} from "../src/mask-cache.js";

/**
 * Reusing mask coverage between grade passes.
 *
 * The point of the cache is that it *hits* — a cache that never does is dead
 * code which still returns the right answer, so every check here asserts the
 * hit count as well as the pixels.
 */

const radial = (id = "m1", radius = 0.3): ClipMask =>
  ({
    id,
    contributions: [
      {
        kind: "radial",
        centre: { x: 0.5, y: 0.5 },
        radius: { x: radius, y: radius },
        feather: 0.4,
        invert: false,
        mode: "add",
      },
    ],
  }) as unknown as ClipMask;

const luminance = (): ClipMask =>
  ({
    id: "lum",
    contributions: [
      { kind: "luminance_range", min: 0.2, max: 0.8, feather: 0.1, mode: "add" },
    ],
  }) as unknown as ClipMask;

beforeEach(() => resetMaskCoverageCache());

describe("maskIsGeometric", () => {
  it("accepts shapes", () => {
    expect(maskIsGeometric(radial())).toBe(true);
  });

  it("rejects a mask that reads the picture", () => {
    // The distinction the whole cache rests on: a luminance range keys off the
    // frame's own brightness, which a grade earlier in the chain changes.
    expect(maskIsGeometric(luminance())).toBe(false);
  });

  it("rejects a mixed mask, not just a wholly image-dependent one", () => {
    const mixed = {
      id: "mix",
      contributions: [
        ...radial().contributions,
        ...luminance().contributions,
      ],
    } as unknown as ClipMask;
    expect(maskIsGeometric(mixed)).toBe(false);
  });
});

describe("geometricCoverage", () => {
  it("rasterises on the first call and reuses after", () => {
    const mask = radial();
    const first = geometricCoverage(mask, 160, 120);
    expect(maskCoverageStats()).toEqual({ hits: 0, misses: 1 });

    const second = geometricCoverage(mask, 160, 120);
    expect(maskCoverageStats()).toEqual({ hits: 1, misses: 1 });
    // The same object, not merely an equal one — proof it was not rebuilt.
    expect(second).toBe(first);
  });

  it("produces real coverage, not an empty buffer", () => {
    // A cache returning a blank mask would hit happily and hide the effect.
    const cov = geometricCoverage(radial(), 160, 120);
    expect(cov.data.length).toBe(160 * 120);
    expect(Math.max(...cov.data)).toBeGreaterThan(200);
    expect(Math.min(...cov.data)).toBe(0);
  });

  it("rebuilds when the shape changes, even under the same id", () => {
    // The key is the contributions, not the id — otherwise dragging a mask's
    // radius would keep serving the shape it had when the drag began.
    const a = geometricCoverage(radial("m1", 0.3), 160, 120);
    const b = geometricCoverage(radial("m1", 0.45), 160, 120);
    expect(b).not.toBe(a);
    expect(maskCoverageStats().hits).toBe(0);
    // And they really are different regions.
    const covered = (m: typeof a): number =>
      [...m.data].filter((v) => v > 128).length;
    expect(covered(b)).toBeGreaterThan(covered(a));
  });

  it("rebuilds at a different size", () => {
    // A preview and an export ask for different resolutions; serving one for
    // the other would stretch the region across the frame.
    const mask = radial();
    const small = geometricCoverage(mask, 160, 120);
    const large = geometricCoverage(mask, 320, 240);
    expect(large).not.toBe(small);
    expect(small.data.length).toBe(160 * 120);
    expect(large.data.length).toBe(320 * 240);
  });

  it("keeps several masks at once", () => {
    // A clip commonly has more than one, and a single-entry cache would thrash
    // between them and never hit.
    const a = radial("a");
    const b = radial("b", 0.5);
    geometricCoverage(a, 160, 120);
    geometricCoverage(b, 160, 120);
    geometricCoverage(a, 160, 120);
    geometricCoverage(b, 160, 120);
    expect(maskCoverageStats()).toEqual({ hits: 2, misses: 2 });
  });

  it("stays bounded rather than growing without limit", () => {
    for (let i = 0; i < 20; i += 1) {
      geometricCoverage(radial(`m${i}`), 64, 64);
    }
    // The oldest are evicted, so the first is gone and rebuilds.
    geometricCoverage(radial("m0"), 64, 64);
    expect(maskCoverageStats().hits).toBe(0);
  });

  it("refuses a mask that reads the picture instead of caching it", () => {
    // Serving a stale luminance region is a wrong picture, so this is an error
    // rather than a silent fallback the caller cannot see.
    expect(() => geometricCoverage(luminance(), 160, 120)).toThrow(
      /reads the picture/,
    );
  });
});
