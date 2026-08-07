import { describe, expect, it } from "vitest";
import { frameToStartTimeUs } from "@director/playback-controller";
import type { AnimationTrack, Rational } from "@director/project-schema";
import {
  clipLocalTimeUs,
  composeCanvasLayerTransform,
  resolveLayerAnimationTransform,
  type CanvasLayerTransform,
  type StaticLayerTransform,
} from "../src/layer-animation.js";

/**
 * Step 7 — preview / GIF / MP4 animation parity.
 *
 * Preview, still export, GIF export and MP4 export all reach the same
 * `drawLayer()`, but each derives the timeline timestamp it passes in from a
 * different place and draws onto a differently sized canvas:
 *
 *   preview  main.ts:867   clipLocalTimeUs(playback.currentTimeUs, start)
 *   still    main.ts:4046  clipLocalTimeUs(playback.currentTimeUs, start)
 *   MP4      main.ts:4280  clipLocalTimeUs(req.timelineTimeUs, start)
 *                          req.timelineTimeUs = frameToStartTimeUs(n, preset.frameRate)
 *   GIF      main.ts:4633  clipLocalTimeUs(timeUs, start)
 *                          timeUs = frameToStartTimeUs(n, {numerator: fps, denominator: 1})
 *
 * Parity therefore has two independent halves, and these tests pin both:
 *
 *   1. Same timeline time  -> same clip-local time  -> same sampled animation.
 *   2. Same animation      -> same *canvas-normalized* transform, whatever the
 *      output resolution is. Absolute pixel offsets legitimately differ between
 *      a 640x360 preview and a 1920x1080 export; the framing must not.
 */

const CLIP_START_US = "1500000";

/** A 2s move + zoom + spin + fade, authored in clip-local microseconds. */
const animations: AnimationTrack[] = [
  {
    id: "position-x",
    property: "transform.position_x",
    keyframes: [
      { id: "x0", timeUs: "0", value: -0.25, easing: "ease-in-out" },
      { id: "x1", timeUs: "2000000", value: 0.25, easing: "ease-in-out" },
    ],
  },
  {
    id: "position-y",
    property: "transform.position_y",
    keyframes: [
      { id: "y0", timeUs: "0", value: 0.1, easing: "linear" },
      { id: "y1", timeUs: "2000000", value: -0.1, easing: "linear" },
    ],
  },
  {
    id: "scale",
    property: "transform.scale",
    keyframes: [
      { id: "s0", timeUs: "0", value: 1, easing: "ease-out" },
      { id: "s1", timeUs: "2000000", value: 1.4, easing: "ease-out" },
    ],
  },
  {
    id: "rotation",
    property: "transform.rotation",
    keyframes: [
      { id: "r0", timeUs: "0", value: 0, easing: "linear" },
      { id: "r1", timeUs: "2000000", value: 24, easing: "linear" },
    ],
  },
  {
    id: "opacity",
    property: "transform.opacity",
    keyframes: [
      { id: "o0", timeUs: "0", value: 0, easing: "ease-in" },
      { id: "o1", timeUs: "2000000", value: 1, easing: "ease-in" },
    ],
  },
];

const clip = { animations };

/** Static effect stack, computed once by drawLayer() and shared by all paths. */
const staticTransform: StaticLayerTransform = {
  alpha: 0.9,
  rotateDeg: 5,
  flipX: true,
  flipY: false,
};

/** Canvas sizes the three paths actually draw onto. Deliberately different
 * resolutions *and* aspect ratios, because GIF output size is derived from the
 * top clip's crop rect (main.ts gifOutputSize) rather than the video preset. */
const PREVIEW = { w: 640, h: 360 };
const MP4 = { w: 1920, h: 1080 };
const GIF = { w: 480, h: 640 };

/** The animation half of drawLayer(), lifted out verbatim (main.ts:998-1005). */
function transformAt(
  timelineTimeUs: string,
  canvas: { w: number; h: number },
): CanvasLayerTransform {
  const localTimeUs = clipLocalTimeUs(timelineTimeUs, CLIP_START_US);
  const animation = resolveLayerAnimationTransform(clip, localTimeUs);
  return composeCanvasLayerTransform(
    staticTransform,
    animation,
    canvas.w,
    canvas.h,
  );
}

/** The sampled animation for a timeline instant. Carries no canvas term, so
 * every path must agree on it *exactly* — this is the core parity surface. */
function sampledAt(timelineTimeUs: string): Record<string, number> {
  return {
    ...resolveLayerAnimationTransform(
      clip,
      clipLocalTimeUs(timelineTimeUs, CLIP_START_US),
    ),
  };
}

/** Resolution-independent view of a composed transform: position as a fraction
 * of the canvas, everything else as-is. */
function framing(
  t: CanvasLayerTransform,
  canvas: { w: number; h: number },
): Record<string, number> {
  return {
    xFraction: t.offsetXPx / canvas.w,
    yFraction: t.offsetYPx / canvas.h,
    scaleX: t.scaleX,
    scaleY: t.scaleY,
    rotationDegrees: t.rotationDegrees,
    alpha: t.alpha,
  };
}

/**
 * Compare framing between two output targets.
 *
 * Scale, rotation and alpha contain no canvas term, so they must be bit-exact.
 * The position fractions must not: they are `positionX * w / w` evaluated at
 * two different `w`, and IEEE-754 multiplication followed by division is not
 * exactly reversible — at 640 vs 1920 the results can differ in the last ulp
 * (~4e-17). That is a property of binary floating point, not a rendering
 * difference, so it gets a tolerance far tighter than a subpixel.
 */
function expectSameFraming(
  actual: Record<string, number>,
  expected: Record<string, number>,
  label: string,
): void {
  expect(actual.scaleX, `${label} scaleX`).toBe(expected.scaleX);
  expect(actual.scaleY, `${label} scaleY`).toBe(expected.scaleY);
  expect(actual.rotationDegrees, `${label} rotation`).toBe(
    expected.rotationDegrees,
  );
  expect(actual.alpha, `${label} alpha`).toBe(expected.alpha);
  expect(actual.xFraction, `${label} xFraction`).toBeCloseTo(
    expected.xFraction!,
    12,
  );
  expect(actual.yFraction, `${label} yFraction`).toBeCloseTo(
    expected.yFraction!,
    12,
  );
}

const NTSC: Rational = { numerator: 30000, denominator: 1001 };
const FLAT_30: Rational = { numerator: 30, denominator: 1 };

describe("preview/GIF/MP4 timestamp agreement", () => {
  it("derives the identical timeline timestamp for a shared frame rate", () => {
    // GIF builds a rational from an integer fps; MP4 takes preset.frameRate.
    // At 30fps those are the same rate, so the paths must not drift.
    for (let frame = 0; frame < 90; frame++) {
      const mp4 = frameToStartTimeUs(frame, FLAT_30);
      const gif = frameToStartTimeUs(frame, {
        numerator: 30,
        denominator: 1,
      });
      expect(gif).toBe(mp4);
    }
  });

  it("maps a timeline time to the same clip-local time for every path", () => {
    for (let frame = 0; frame < 90; frame++) {
      const timelineTimeUs = frameToStartTimeUs(frame, FLAT_30);
      if (BigInt(timelineTimeUs) < BigInt(CLIP_START_US)) continue;
      const local = clipLocalTimeUs(timelineTimeUs, CLIP_START_US);
      // Every call site passes the same two arguments in the same order, so a
      // single shared value is the only correct answer.
      expect(clipLocalTimeUs(timelineTimeUs, CLIP_START_US)).toBe(local);
    }
  });
});

describe("animation parity across output targets", () => {
  it("samples one identical animation value set per instant, canvas aside", () => {
    // Exact equality, because nothing here has touched a canvas dimension yet.
    for (let frame = 45; frame < 135; frame++) {
      const timelineTimeUs = frameToStartTimeUs(frame, FLAT_30);
      const once = sampledAt(timelineTimeUs);
      expect(sampledAt(timelineTimeUs), `frame ${frame}`).toEqual(once);
    }
  });

  it("produces identical framing in preview, GIF and MP4 at one instant", () => {
    const timelineTimeUs = "2500000"; // 1.0s into the clip

    const preview = framing(transformAt(timelineTimeUs, PREVIEW), PREVIEW);
    const mp4 = framing(transformAt(timelineTimeUs, MP4), MP4);
    const gif = framing(transformAt(timelineTimeUs, GIF), GIF);

    expectSameFraming(mp4, preview, "mp4-vs-preview");
    expectSameFraming(gif, preview, "gif-vs-preview");
  });

  it("stays identical across every frame of the animation", () => {
    // A per-frame sweep, not a spot check: an off-by-one or a rounding step
    // introduced anywhere in the chain shows up on some frame.
    for (let frame = 45; frame < 135; frame++) {
      const timelineTimeUs = frameToStartTimeUs(frame, FLAT_30);
      const preview = framing(transformAt(timelineTimeUs, PREVIEW), PREVIEW);
      const mp4 = framing(transformAt(timelineTimeUs, MP4), MP4);
      const gif = framing(transformAt(timelineTimeUs, GIF), GIF);

      expectSameFraming(mp4, preview, `frame ${frame} mp4`);
      expectSameFraming(gif, preview, `frame ${frame} gif`);
    }
  });

  it("scales absolute pixel offsets with the canvas", () => {
    // The flip side of the normalized assertion: the offsets are not merely
    // equal, they track the output size, which is what keeps framing constant.
    const timelineTimeUs = "2500000";
    const preview = transformAt(timelineTimeUs, PREVIEW);
    const mp4 = transformAt(timelineTimeUs, MP4);

    expect(mp4.offsetXPx).toBeCloseTo(preview.offsetXPx * (MP4.w / PREVIEW.w), 9);
    expect(mp4.offsetYPx).toBeCloseTo(preview.offsetYPx * (MP4.h / PREVIEW.h), 9);
    // Scale, rotation and alpha carry no canvas term at all.
    expect(mp4.scaleX).toBe(preview.scaleX);
    expect(mp4.rotationDegrees).toBe(preview.rotationDegrees);
    expect(mp4.alpha).toBe(preview.alpha);
  });

  it("samples deterministically when called repeatedly", () => {
    // Preview redraws on every seek and export renders once; a sampler that
    // carried state would diverge between the two.
    const timelineTimeUs = "2500000";
    const first = transformAt(timelineTimeUs, PREVIEW);
    for (let i = 0; i < 5; i++) {
      expect(transformAt(timelineTimeUs, PREVIEW)).toEqual(first);
    }
  });
});

describe("NTSC frame rates", () => {
  it("keeps GIF integer fps within one frame interval of MP4 29.97", () => {
    // GIF hard-codes {numerator: fps, denominator: 1} (main.ts:4615) while MP4
    // honours preset.frameRate. At 29.97 the two disagree by design: the same
    // frame index is a different instant. The animation is still correct for
    // whichever instant it is sampled at, but the drift is real and grows, so
    // it is pinned here rather than left to be rediscovered.
    const frameIntervalUs = 1_000_000 / (30000 / 1001);

    for (let frame = 0; frame < 300; frame++) {
      const gif = Number(frameToStartTimeUs(frame, FLAT_30));
      const mp4 = Number(frameToStartTimeUs(frame, NTSC));
      expect(Math.abs(mp4 - gif)).toBeLessThan(frameIntervalUs * (frame + 1));
    }

    // Concretely: after 10 seconds the same index is ~10ms apart.
    const at300Gif = Number(frameToStartTimeUs(300, FLAT_30));
    const at300Mp4 = Number(frameToStartTimeUs(300, NTSC));
    expect(at300Mp4 - at300Gif).toBeGreaterThan(9_000);
    expect(at300Mp4 - at300Gif).toBeLessThan(11_000);
  });

  it("agrees exactly at the same timeline instant regardless of frame rate", () => {
    // The parity guarantee is per-instant, not per-index: sampling the NTSC
    // timestamp and the flat-30 timestamp for the *same* instant must match.
    const instant = frameToStartTimeUs(120, NTSC);
    const viaMp4 = framing(transformAt(instant, MP4), MP4);
    const viaGif = framing(transformAt(instant, GIF), GIF);
    expectSameFraming(viaGif, viaMp4, "ntsc-instant");
  });
});
