import { describe, expect, it } from "vitest";
import { trackPoint, APPROX_MAX_DISPLACEMENT_PX } from "../src/lucas-kanade.js";
import { flat, texture, translate } from "./helpers.js";

/**
 * Following a point, checked against motion this file chose.
 *
 * Every number below is ground truth, not a golden value recorded from a run:
 * the frame is translated by a known amount and the tracker must recover it.
 * A test that recorded whatever the implementation produced would agree with a
 * broken tracker forever.
 *
 * The tolerances were **measured** rather than argued. Observed error on these
 * patterns is well under a tenth of a pixel for whole-pixel motion and about a
 * fifth for the sub-pixel and large-motion cases; the bounds are set just above
 * what was seen, and each is checked to fail when the relevant part of the
 * implementation is broken. A bound picked by reasoning tends to land exactly
 * at the size of the bug it was meant to catch — that happened in this repo
 * with a shader tolerance and nearly shipped.
 */

// A realistic frame size. The pyramid depth available to a tracker is set by
// the frame, and a small test frame silently limits how far it can reach — an
// artefact of the test, not of the method.
const WIDTH = 320;
const HEIGHT = 256;
const CENTRE = { x: 160, y: 128 };

/** How far the recovered motion may sit from the truth, in pixels. */
const TOLERANCE_PX = 0.3;

describe("trackPoint", () => {
  it("recovers a whole-pixel translation", () => {
    const a = texture(WIDTH, HEIGHT);
    const b = translate(a, 3, -2);
    const r = trackPoint(a, b, CENTRE);

    expect(r.lost).toBe(false);
    expect(r.point.x - CENTRE.x).toBeCloseTo(3, 1);
    expect(r.point.y - CENTRE.y).toBeCloseTo(-2, 1);
  });

  it("recovers a sub-pixel translation", () => {
    // The case that separates a real tracker from one that quantises to whole
    // pixels. An implementation sampling nearest-neighbour passes the test
    // above and fails this one.
    const a = texture(WIDTH, HEIGHT);
    const b = translate(a, 2.4, 1.7);
    const r = trackPoint(a, b, CENTRE);

    expect(r.lost).toBe(false);
    expect(Math.abs(r.point.x - CENTRE.x - 2.4)).toBeLessThan(TOLERANCE_PX);
    expect(Math.abs(r.point.y - CENTRE.y - 1.7)).toBeLessThan(TOLERANCE_PX);
  });

  it("recovers a fraction smaller than a third of a pixel", () => {
    // Deliberately below the tolerance itself: a tracker that always returned
    // zero motion would pass a 0.2px test with a 0.3px bound, so the assertion
    // is that it lands near 0.2 *and* not near 0.
    const a = texture(WIDTH, HEIGHT);
    const b = translate(a, 0.2, -0.25);
    const r = trackPoint(a, b, CENTRE);

    expect(r.lost).toBe(false);
    const dx = r.point.x - CENTRE.x;
    const dy = r.point.y - CENTRE.y;
    expect(Math.abs(dx - 0.2)).toBeLessThan(0.15);
    expect(Math.abs(dy + 0.25)).toBeLessThan(0.15);
    // Actually moved, rather than reporting no motion and being within bounds.
    expect(Math.abs(dx)).toBeGreaterThan(0.05);
  });

  it("recovers motion far larger than one pixel, which needs the pyramid", () => {
    // 24 pixels is well outside the linearisation a single-level solve is valid
    // for. This is the test the pyramid exists to pass.
    const a = texture(WIDTH, HEIGHT);
    const b = translate(a, 24, 16);
    const r = trackPoint(a, b, CENTRE);

    expect(r.lost).toBe(false);
    expect(Math.abs(r.point.x - CENTRE.x - 24)).toBeLessThan(1);
    expect(Math.abs(r.point.y - CENTRE.y - 16)).toBeLessThan(1);
  });

  it("has a reach, and it is the documented one", () => {
    // A limit of the method, not a bug: each level walks about a window radius
    // and there are four levels. Pinned so the documentation cannot drift away
    // from the behaviour, and so anyone raising the window or the level count
    // sees what it bought.
    const a = texture(WIDTH, HEIGHT);
    const within = trackPoint(a, translate(a, 24, 16), CENTRE);
    expect(Math.abs(within.point.x - CENTRE.x - 24)).toBeLessThan(1);

    // Beyond it the tracker converges to a local minimum and says so
    // confidently — which is exactly why the limit is written down.
    const beyond = trackPoint(a, translate(a, 60, 45), CENTRE);
    expect(Math.abs(beyond.point.x - CENTRE.x - 60)).toBeGreaterThan(5);
    expect(APPROX_MAX_DISPLACEMENT_PX).toBe(28);
  });

  it("reports no motion when there is none", () => {
    const a = texture(WIDTH, HEIGHT);
    const r = trackPoint(a, a, CENTRE);

    expect(r.lost).toBe(false);
    expect(Math.abs(r.point.x - CENTRE.x)).toBeLessThan(0.05);
    expect(Math.abs(r.point.y - CENTRE.y)).toBeLessThan(0.05);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("gives up on a flat region instead of inventing a confident answer", () => {
    // The aperture problem's worst case. A tracker without a structure check
    // returns a number here — often a large one, since the system is singular
    // and any displacement fits equally well.
    const a = flat(WIDTH, HEIGHT);
    const b = translate(a, 3, 3);
    const r = trackPoint(a, b, CENTRE);

    expect(r.lost).toBe(true);
    expect(r.confidence).toBe(0);
  });

  it("refuses a point too close to the edge to hold a window", () => {
    // Not squeamishness. The window would be mostly clamped border, which is a
    // large flat region the solve locks onto — so it would return a confident
    // number measured from an artefact of the clamping.
    const a = texture(WIDTH, HEIGHT);
    const b = translate(a, 2, 2);
    expect(trackPoint(a, b, { x: 3, y: 128 }).lost).toBe(true);
    expect(trackPoint(a, b, { x: WIDTH - 4, y: 128 }).lost).toBe(true);
    // And a point one window in from the same edge is fine.
    expect(trackPoint(a, b, { x: 20, y: 128 }).lost).toBe(false);
  });

  it("gives up when the point is tracked off the frame", () => {
    const a = texture(WIDTH, HEIGHT);
    const b = translate(a, 24, 0);
    // Starts inside, lands outside: there is nothing there to have followed.
    const r = trackPoint(a, b, { x: WIDTH - 12, y: 128 });
    expect(r.lost).toBe(true);
  });

  it("refuses mismatched frame sizes rather than reading past the end", () => {
    const a = texture(WIDTH, HEIGHT);
    const b = texture(WIDTH - 4, HEIGHT);
    expect(trackPoint(a, b, CENTRE).lost).toBe(true);
  });

  it("is more confident on texture than on near-flat ground", () => {
    // Confidence has to be a *reading*, not a constant. Comparing two patches
    // is the check that it varies with what is actually there.
    const strong = texture(WIDTH, HEIGHT);
    const weak: typeof strong = {
      width: WIDTH,
      height: HEIGHT,
      luma: new Uint8ClampedArray(
        [...strong.luma].map((v) => 128 + (v - 128) * 0.06),
      ),
    };
    const a = trackPoint(strong, translate(strong, 1, 1), CENTRE);
    const b = trackPoint(weak, translate(weak, 1, 1), CENTRE);

    expect(a.lost).toBe(false);
    expect(a.confidence).toBeGreaterThan(b.confidence);
    expect(a.confidence).toBeLessThanOrEqual(1);
    expect(b.confidence).toBeGreaterThanOrEqual(0);
  });

  it("keeps the structure threshold clear of both failure modes", () => {
    // Pins the measurement the MIN_EIGENVALUE constant was set from, so a later
    // change to the window or the gradients cannot quietly move the threshold
    // into either "rejects real texture" or "accepts flat ground".
    const t = texture(WIDTH, HEIGHT);
    const textured = trackPoint(t, t, CENTRE);
    const nothing = trackPoint(
      flat(WIDTH, HEIGHT),
      flat(WIDTH, HEIGHT),
      CENTRE,
    );

    expect(textured.lost).toBe(false);
    expect(textured.confidence).toBeGreaterThan(0.3);
    expect(nothing.lost).toBe(true);
  });
});
