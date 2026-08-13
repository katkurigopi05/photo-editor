import { describe, expect, it } from "vitest";
import {
  buildPyramid,
  halve,
  sampleBilinear,
  insideFrame,
  MIN_LEVEL_SIZE,
} from "../src/pyramid.js";
import { flat, texture } from "./helpers.js";

describe("halve", () => {
  it("produces half-size levels", () => {
    const f = halve(texture(64, 48));
    expect(f.width).toBe(32);
    expect(f.height).toBe(24);
    expect(f.luma.length).toBe(32 * 24);
  });

  it("averages rather than dropping pixels", () => {
    // A one-pixel-wide stripe pattern. Point sampling keeps whichever column it
    // lands on and the result is a solid field; averaging keeps the mid-grey.
    // The difference matters because a subsampled fence moves differently from
    // the real one, and the tracker would follow the alias faithfully.
    const width = 32;
    const height = 8;
    const luma = new Uint8ClampedArray(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        luma[y * width + x] = x % 2 === 0 ? 0 : 200;
      }
    }
    const small = halve({ width, height, luma });
    for (const v of small.luma) expect(v).toBe(100);
  });

  it("keeps a flat field flat", () => {
    for (const v of halve(flat(32, 32, 77)).luma) expect(v).toBe(77);
  });
});

describe("buildPyramid", () => {
  it("starts with the frame itself", () => {
    const f = texture(320, 256);
    expect(buildPyramid(f)[0]).toBe(f);
  });

  it("halves each level", () => {
    const sizes = buildPyramid(texture(320, 256)).map(
      (f) => `${f.width}x${f.height}`,
    );
    expect(sizes).toEqual(["320x256", "160x128", "80x64", "40x32"]);
  });

  it("stops before a level gets too small to hold a window", () => {
    // The constraint that forced the window down from 21 to 15: a window
    // larger than the level is almost all clamped border, and the solve locks
    // onto the clamping instead of the picture.
    for (const f of buildPyramid(texture(96, 72), 8)) {
      expect(Math.min(f.width, f.height)).toBeGreaterThanOrEqual(
        MIN_LEVEL_SIZE,
      );
    }
  });

  it("never returns more levels than asked for", () => {
    expect(buildPyramid(texture(320, 256), 2)).toHaveLength(2);
    expect(buildPyramid(texture(320, 256), 1)).toHaveLength(1);
  });
});

describe("sampleBilinear", () => {
  const frame = {
    width: 2,
    height: 2,
    luma: new Uint8ClampedArray([0, 100, 200, 255]),
  };

  it("returns the pixel exactly on whole coordinates", () => {
    expect(sampleBilinear(frame, 0, 0)).toBe(0);
    expect(sampleBilinear(frame, 1, 0)).toBe(100);
    expect(sampleBilinear(frame, 0, 1)).toBe(200);
    expect(sampleBilinear(frame, 1, 1)).toBe(255);
  });

  it("interpolates between them", () => {
    // The property the whole sub-pixel claim rests on. Nearest-neighbour would
    // return 0 or 100 here, never 50.
    expect(sampleBilinear(frame, 0.5, 0)).toBe(50);
    expect(sampleBilinear(frame, 0, 0.5)).toBe(100);
    expect(sampleBilinear(frame, 0.5, 0.5)).toBeCloseTo(138.75, 5);
  });

  it("varies smoothly rather than in steps", () => {
    // A stronger form of the same claim: eleven samples across one pixel must
    // give eleven different values.
    const seen = new Set<number>();
    for (let t = 0; t <= 1.0001; t += 0.1) {
      seen.add(Number(sampleBilinear(frame, t, 0).toFixed(4)));
    }
    expect(seen.size).toBe(11);
  });

  it("clamps outside the frame instead of wrapping", () => {
    // Wrapping would make the left edge match the right, which is fake
    // structure the solve would lock onto.
    expect(sampleBilinear(frame, -5, 0)).toBe(0);
    expect(sampleBilinear(frame, 99, 0)).toBe(100);
    expect(sampleBilinear(frame, 0, 99)).toBe(200);
  });
});

describe("insideFrame", () => {
  const f = texture(100, 80);

  it("accepts a point with room for its margin", () => {
    expect(insideFrame(f, 50, 40, 7)).toBe(true);
  });

  it("rejects one without", () => {
    expect(insideFrame(f, 3, 40, 7)).toBe(false);
    expect(insideFrame(f, 50, 76, 7)).toBe(false);
  });

  it("treats the boundary as inside", () => {
    expect(insideFrame(f, 7, 7, 7)).toBe(true);
    expect(insideFrame(f, 6.99, 7, 7)).toBe(false);
  });
});
