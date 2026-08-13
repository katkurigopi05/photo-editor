import { describe, expect, it } from "vitest";
import {
  planStabilisation,
  type FrameMotion,
} from "../src/plan-stabilisation.js";
import type { RigidTransform } from "../src/types.js";

/**
 * Planning the correction.
 *
 * The claim that matters is not "it removes motion" — flattening everything is
 * easy and looks wrong. It is that **shake goes and an intended pan stays**,
 * because those are the same measurements and only the plan tells them apart.
 */

const WIDTH = 1920;
const HEIGHT = 1080;

const step = (dx: number, dy: number, rot = 0, scale = 1): RigidTransform => ({
  dx,
  dy,
  rotationRad: rot,
  scale,
  confidence: 1,
});

/** Frames at 30fps. */
const at = (i: number): string => String(Math.round((i * 1_000_000) / 30));

const motions = (steps: RigidTransform[]): FrameMotion[] =>
  steps.map((transform, i) => ({ timeUs: at(i), transform }));

const track = (
  plan: ReturnType<typeof planStabilisation>,
  property: string,
): number[] =>
  plan.tracks
    .find((t) => t.property === property)!
    .keyframes.map((k) => k.value);

describe("planStabilisation", () => {
  it("does nothing to a locked-off shot", () => {
    const plan = planStabilisation(
      motions(Array.from({ length: 30 }, () => step(0, 0))),
      { width: WIDTH, height: HEIGHT },
    );
    for (const v of track(plan, "transform.position_x")) {
      expect(Math.abs(v)).toBeLessThan(1e-9);
    }
    expect(plan.requiredScale).toBeCloseTo(1, 6);
  });

  it("cancels shake", () => {
    // Alternating jitter with no net movement: the camera is where it started
    // but never held still. All of this should be removed.
    const steps = Array.from({ length: 40 }, (_, i) =>
      step(i % 2 === 0 ? 8 : -8, 0),
    );
    const plan = planStabilisation(motions(steps), {
      width: WIDTH,
      height: HEIGHT,
    });

    const corrections = track(plan, "transform.position_x");
    // Every correction is non-trivial and opposes the jitter, rather than the
    // plan quietly doing nothing.
    expect(Math.max(...corrections.map(Math.abs))).toBeGreaterThan(1 / WIDTH);
    expect(plan.maxCorrectionFraction).toBeGreaterThan(0);
    // And the crop it costs is small, because the shake is small.
    expect(plan.requiredScale).toBeLessThan(1.05);
  });

  it("keeps a steady pan instead of fighting it", () => {
    // The load-bearing test. A constant 4px/frame pan is *intended* camera
    // movement. A stabiliser that removes it leaves the subject sliding inside
    // a frozen frame and needs an ever-growing crop to do it.
    const steps = Array.from({ length: 60 }, () => step(4, 0));
    const plan = planStabilisation(motions(steps), {
      width: WIDTH,
      height: HEIGHT,
    });

    const corrections = track(plan, "transform.position_x");
    // Away from the ends, a constant-velocity path is its own smoothed version,
    // so the correction is essentially nothing.
    const middle = corrections.slice(20, 40);
    for (const v of middle) expect(Math.abs(v)).toBeLessThan(0.002);
    // A stabiliser that flattened the pan would need a crop of ~12% of the
    // width by the end of this shot.
    expect(plan.requiredScale).toBeLessThan(1.02);
  });

  it("removes shake that sits on top of a pan, and leaves the pan", () => {
    // Both together, which is what real handheld footage is.
    const steps = Array.from({ length: 60 }, (_, i) =>
      step(4 + (i % 2 === 0 ? 6 : -6), 0),
    );
    const plan = planStabilisation(motions(steps), {
      width: WIDTH,
      height: HEIGHT,
    });
    const corrections = track(plan, "transform.position_x").slice(20, 40);

    // The correction alternates sign — it is cancelling the jitter — while
    // staying small, because the pan underneath is left alone.
    const signs = new Set(
      corrections.map((v) => Math.sign(Math.round(v * 1e6))),
    );
    expect(signs.size).toBeGreaterThan(1);
    expect(Math.max(...corrections.map(Math.abs))).toBeLessThan(0.01);
  });

  it("reports the crop the correction costs", () => {
    const steps = Array.from({ length: 40 }, (_, i) =>
      step(i % 2 === 0 ? 60 : -60, 0),
    );
    const plan = planStabilisation(motions(steps), {
      width: WIDTH,
      height: HEIGHT,
    });

    // A correction of f at one edge needs 2f of zoom to cover both sides.
    expect(plan.requiredScale).toBeCloseTo(
      1 + 2 * plan.maxCorrectionFraction,
      6,
    );
    expect(plan.requiredScale).toBeGreaterThan(1.01);
  });

  it("writes position as a fraction of the frame, not pixels", () => {
    // The units the animation schema actually uses. Getting this wrong would
    // move the picture by a factor of the frame size — off screen entirely —
    // and the schema would accept it, since 1920 is outside the ±2 range and
    // would simply be refused later with no clue why.
    const steps = Array.from({ length: 40 }, (_, i) =>
      step(i % 2 === 0 ? 96 : -96, 0),
    );
    const plan = planStabilisation(motions(steps), {
      width: WIDTH,
      height: HEIGHT,
    });
    for (const v of track(plan, "transform.position_x")) {
      expect(Math.abs(v)).toBeLessThanOrEqual(2);
    }
  });

  it("writes rotation in degrees", () => {
    const steps = Array.from({ length: 40 }, (_, i) =>
      step(0, 0, i % 2 === 0 ? 0.05 : -0.05),
    );
    const plan = planStabilisation(motions(steps), {
      width: WIDTH,
      height: HEIGHT,
    });
    const degrees = track(plan, "transform.rotation");
    const peak = Math.max(...degrees.map(Math.abs));
    // 0.05 rad is about 2.9°. In radians the peak would be under 0.05 and this
    // would fail — which is the point.
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(10);
  });

  it("averages scale multiplicatively", () => {
    // A 1.25× followed by a 0.8× is no change. Averaged arithmetically it
    // would read as 1.025 and the plan would slowly zoom the shot.
    const steps = Array.from({ length: 40 }, (_, i) =>
      step(0, 0, 0, i % 2 === 0 ? 1.25 : 0.8),
    );
    const plan = planStabilisation(motions(steps), {
      width: WIDTH,
      height: HEIGHT,
    });
    const scales = track(plan, "transform.scale").slice(10, 30);

    // The *geometric* mean, and the first version of this test used the
    // arithmetic one — which is the same mistake the test exists to catch. The
    // corrections are exp(±d), whose arithmetic mean is cosh(d) ≈ 1 + d²/2, so
    // a correct implementation read as 1.0057 and looked like a slow zoom.
    const logMean = scales.reduce((a, b) => a + Math.log(b), 0) / scales.length;
    expect(Math.exp(logMean)).toBeCloseTo(1, 3);

    // And the alternation really is there, rather than every value being 1.
    expect(Math.max(...scales)).toBeGreaterThan(1.01);
    expect(Math.min(...scales)).toBeLessThan(0.99);
  });

  it("returns to where it started after a zoom and its exact inverse", () => {
    // The test that actually pins log-space accumulation, and it had to be
    // found by mutation: the "averages multiplicatively" test above passes
    // against arithmetic accumulation, because the correction is a *difference*
    // and a constant drift cancels out of it — the same reason a steady pan
    // survives.
    //
    // This does not cancel. Zooming in by 1.25 twenty times and back out by 0.8
    // twenty times ends exactly where it began, so the first and last
    // corrections must match. Accumulating (s − 1) instead of log(s) drifts by
    // 0.05 per pair and breaks the symmetry: 2.181 against 1.866.
    const steps = [
      ...Array.from({ length: 20 }, () => step(0, 0, 0, 1.25)),
      ...Array.from({ length: 20 }, () => step(0, 0, 0, 0.8)),
    ];
    const scales = track(
      planStabilisation(motions(steps), { width: WIDTH, height: HEIGHT }),
      "transform.scale",
    );

    expect(scales[0]).toBeCloseTo(scales[scales.length - 1]!, 4);
    // And the shot really did zoom, rather than every value sitting at 1.
    expect(scales[0]).toBeGreaterThan(1.5);
  });

  it("keeps keyframe times strictly increasing, as the schema demands", () => {
    const plan = planStabilisation(
      motions(Array.from({ length: 20 }, () => step(3, 2))),
      { width: WIDTH, height: HEIGHT },
    );
    for (const t of plan.tracks) {
      const times = t.keyframes.map((k) => BigInt(k.timeUs));
      for (let i = 1; i < times.length; i += 1) {
        expect(times[i]! > times[i - 1]!).toBe(true);
      }
    }
  });

  it("declines rather than guessing from too few samples", () => {
    expect(
      planStabilisation([], { width: WIDTH, height: HEIGHT }).tracks,
    ).toHaveLength(0);
    expect(
      planStabilisation(motions([step(0, 0), step(5, 5)]), {
        width: WIDTH,
        height: HEIGHT,
      }).requiredScale,
    ).toBe(1);
  });

  it("accounts for roll when accumulating later translations", () => {
    // After a 90° roll, the camera's "right" is the world's "down". Adding raw
    // dx and dy would place the path in the wrong direction and the correction
    // would push the picture the wrong way.
    const steps = [
      step(0, 0),
      step(0, 0, Math.PI / 2),
      ...Array.from({ length: 20 }, () => step(10, 0)),
    ];
    const plan = planStabilisation(motions(steps), {
      width: WIDTH,
      height: HEIGHT,
    });
    // The sustained motion after the roll is vertical in world terms, so the
    // corrections must appear on y rather than x.
    const xs = track(plan, "transform.position_x").slice(5);
    const ys = track(plan, "transform.position_y").slice(5);
    expect(Math.max(...ys.map(Math.abs))).toBeGreaterThan(
      Math.max(...xs.map(Math.abs)),
    );
  });
});
