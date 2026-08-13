import { describe, expect, it } from "vitest";
import { solveStabilisation, samplingGrid } from "../src/stabilise.js";
import { flat, rotate, texture, translate, withBlock } from "./helpers.js";

/**
 * Measuring how the whole frame moved.
 *
 * Same discipline as the tracker's tests: the motion is applied here, so every
 * expected number is ground truth rather than a recorded output.
 *
 * The case that matters most is the last one. A person walking through an
 * otherwise still shot is the common case, not an edge case, and plain least
 * squares averages their motion into the camera's — producing a stabilisation
 * that gently follows the subject and shakes the background.
 */

const WIDTH = 320;
const HEIGHT = 256;

describe("solveStabilisation", () => {
  it("finds a pure translation", () => {
    const a = texture(WIDTH, HEIGHT);
    const r = solveStabilisation(a, translate(a, 6, -4));

    expect(r.dx).toBeCloseTo(6, 0);
    expect(r.dy).toBeCloseTo(-4, 0);
    expect(r.rotationRad).toBeCloseTo(0, 2);
    expect(r.scale).toBeCloseTo(1, 2);
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it("finds a rotation", () => {
    const a = texture(WIDTH, HEIGHT);
    const radians = 0.05;
    const r = solveStabilisation(a, rotate(a, radians));

    expect(r.rotationRad).toBeCloseTo(radians, 2);
    expect(r.scale).toBeCloseTo(1, 2);
  });

  it("finds a scale", () => {
    const a = texture(WIDTH, HEIGHT);
    const r = solveStabilisation(a, rotate(a, 0, 1.05));

    expect(r.scale).toBeCloseTo(1.05, 2);
    expect(r.rotationRad).toBeCloseTo(0, 2);
  });

  it("finds rotation and translation together", () => {
    const a = texture(WIDTH, HEIGHT);
    const moved = translate(rotate(a, 0.04), 5, 3);
    const r = solveStabilisation(a, moved);

    expect(r.rotationRad).toBeCloseTo(0.04, 2);
    // Applying the solved transform to the centre must land where the picture
    // actually went — a better check than dx/dy alone, which trade off against
    // rotation about a different origin.
    const cx = (WIDTH - 1) / 2;
    const cy = (HEIGHT - 1) / 2;
    const cos = Math.cos(r.rotationRad) * r.scale;
    const sin = Math.sin(r.rotationRad) * r.scale;
    expect(r.dx + (cx * cos - cy * sin)).toBeCloseTo(cx + 5, 0);
    expect(r.dy + (cx * sin + cy * cos)).toBeCloseTo(cy + 3, 0);
  });

  it("reports identity for identical frames", () => {
    const a = texture(WIDTH, HEIGHT);
    const r = solveStabilisation(a, a);

    expect(r.dx).toBeCloseTo(0, 2);
    expect(r.dy).toBeCloseTo(0, 2);
    expect(r.rotationRad).toBeCloseTo(0, 3);
    expect(r.scale).toBeCloseTo(1, 3);
  });

  it("ignores a moving subject and reports the camera", () => {
    // The load-bearing test. The background moves 5,0; a textured block moves
    // 30,20 across it. A plain least-squares fit would split the difference and
    // return something between the two — a stabiliser that half-follows the
    // subject, which looks worse than no stabilisation at all.
    const base = texture(WIDTH, HEIGHT);
    const a = withBlock(base, 60, 60, 70);
    const b = withBlock(translate(base, 5, 0), 90, 80, 70);

    const r = solveStabilisation(a, b);

    expect(r.dx).toBeCloseTo(5, 0);
    expect(r.dy).toBeCloseTo(0, 0);
    // And it says the grid did not fully agree, rather than claiming certainty.
    expect(r.confidence).toBeLessThan(1);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("declines rather than guessing when there is nothing to track", () => {
    const a = flat(WIDTH, HEIGHT);
    const r = solveStabilisation(a, translate(a, 5, 5));

    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
    expect(r.scale).toBe(1);
    expect(r.confidence).toBe(0);
  });

  it("declines on mismatched sizes", () => {
    const r = solveStabilisation(
      texture(WIDTH, HEIGHT),
      texture(WIDTH - 8, HEIGHT),
    );
    expect(r.confidence).toBe(0);
  });
});

describe("samplingGrid", () => {
  it("stays clear of the edges", () => {
    const f = texture(WIDTH, HEIGHT);
    for (const p of samplingGrid(f)) {
      expect(p.x).toBeGreaterThan(11);
      expect(p.y).toBeGreaterThan(11);
      expect(p.x).toBeLessThan(WIDTH - 11);
      expect(p.y).toBeLessThan(HEIGHT - 11);
    }
  });

  it("covers the frame rather than clustering", () => {
    const points = samplingGrid(texture(WIDTH, HEIGHT));
    expect(points.length).toBeGreaterThan(30);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(WIDTH * 0.6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(HEIGHT * 0.6);
  });

  it("returns nothing for a frame too small to hold a window", () => {
    expect(samplingGrid(texture(16, 16))).toHaveLength(0);
  });
});
