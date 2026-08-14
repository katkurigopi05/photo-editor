import type {
  AnimationEasing,
  CubicBezier,
  AnimationProperty,
  AnimationTrack,
  TimelineClip,
} from "@director/project-schema";

const CANONICAL_MICROSECONDS = /^(0|[1-9][0-9]*)$/;
const PROGRESS_SCALE = 1_000_000_000n;
const BEZIER_ITERATIONS = 24;

function parseLocalTime(timeUs: string): bigint {
  if (!CANONICAL_MICROSECONDS.test(timeUs)) {
    throw new RangeError(
      "local time must be canonical nonnegative microseconds",
    );
  }
  return BigInt(timeUs);
}

function cubicCoordinate(t: number, first: number, second: number): number {
  const inverse = 1 - t;
  return (
    3 * inverse * inverse * t * first + 3 * inverse * t * t * second + t * t * t
  );
}

/** Resolve y for a CSS-style cubic Bézier at the requested x. Fixed-count
 * bisection avoids platform clocks, tolerances, and data-dependent loops. */
function cubicBezier(
  progress: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  if (progress === 0 || progress === 1) return progress;
  let low = 0;
  let high = 1;
  for (let index = 0; index < BEZIER_ITERATIONS; index++) {
    const midpoint = (low + high) / 2;
    if (cubicCoordinate(midpoint, x1, x2) < progress) low = midpoint;
    else high = midpoint;
  }
  return cubicCoordinate((low + high) / 2, y1, y2);
}

/**
 * Apply a hand-drawn easing curve to normalized progress.
 *
 * Exposed separately from the named easings because a custom curve supersedes
 * them rather than joining them: a keyframe carrying one is not "ease-in with
 * extras", it is a different curve, and the named value stays only so the curve
 * can be discarded back to something.
 *
 * The solver is the same one the named easings already used, so a custom curve
 * matching CSS's ease-in control points produces exactly what `ease-in` does —
 * which is a property worth having and is asserted in the tests.
 */
export function applyBezierEasing(
  bezier: CubicBezier,
  progress: number,
): number {
  if (!Number.isFinite(progress)) {
    throw new RangeError("animation progress must be finite");
  }
  const clamped = Math.min(1, Math.max(0, progress));
  return cubicBezier(clamped, bezier.x1, bezier.y1, bezier.x2, bezier.y2);
}

/**
 * The easing a keyframe actually uses.
 *
 * One place decides, so the precedence cannot be implemented differently by the
 * renderer and the exporter and drift apart — which is exactly the kind of
 * disagreement that shows up as an export not matching the preview.
 */
export function easeKeyframe(
  // `| undefined` because the project compiles with exactOptionalPropertyTypes,
  // which keeps "absent" and "present but undefined" distinct — the same
  // distinction canonical JSON depends on.
  keyframe: { easing: AnimationEasing; bezier?: CubicBezier | undefined },
  progress: number,
): number {
  return keyframe.bezier
    ? applyBezierEasing(keyframe.bezier, progress)
    : applyAnimationEasing(keyframe.easing, progress);
}

/** Apply one supported easing to normalized progress. Ease curves use the CSS
 * control points for `ease-in`, `ease-out`, and `ease-in-out`. */
export function applyAnimationEasing(
  easing: AnimationEasing,
  progress: number,
): number {
  if (!Number.isFinite(progress)) {
    throw new RangeError("animation progress must be finite");
  }
  const clamped = Math.min(1, Math.max(0, progress));
  switch (easing) {
    case "linear":
      return clamped;
    case "hold":
      return clamped < 1 ? 0 : 1;
    case "ease-in":
      return cubicBezier(clamped, 0.42, 0, 1, 1);
    case "ease-out":
      return cubicBezier(clamped, 0, 0, 0.58, 1);
    case "ease-in-out":
      return cubicBezier(clamped, 0.42, 0, 0.58, 1);
  }
}

function normalizedProgress(
  time: bigint,
  startTime: bigint,
  endTime: bigint,
): number {
  const duration = endTime - startTime;
  if (duration <= 0n) {
    throw new RangeError(
      "animation keyframe times must be strictly increasing",
    );
  }
  const elapsed = time - startTime;
  const scaled = (elapsed * PROGRESS_SCALE) / duration;
  return Number(scaled) / Number(PROGRESS_SCALE);
}

/** Sample one validated animation track at clip-local time. Values clamp to
 * the first and last keyframes outside the authored range. A keyframe's easing
 * controls its outgoing segment. */
export function sampleAnimationTrack(
  track: AnimationTrack,
  localTimeUs: string,
): number {
  const time = parseLocalTime(localTimeUs);
  const first = track.keyframes[0];
  if (first === undefined) {
    throw new RangeError("animation track must contain at least one keyframe");
  }
  if (time <= BigInt(first.timeUs)) return first.value;

  for (let index = 0; index < track.keyframes.length - 1; index++) {
    const left = track.keyframes[index]!;
    const right = track.keyframes[index + 1]!;
    const rightTime = BigInt(right.timeUs);
    if (time < rightTime) {
      const progress = normalizedProgress(time, BigInt(left.timeUs), rightTime);
      // The *left* keyframe's easing governs the span leaving it, so a curve
      // drawn on a keyframe shapes the move away from it — which is what the
      // curve appears to do when drawn beside that keyframe.
      const eased = easeKeyframe(left, progress);
      return left.value + (right.value - left.value) * eased;
    }
  }

  return track.keyframes[track.keyframes.length - 1]!.value;
}

export type SampledClipAnimations = Partial<Record<AnimationProperty, number>>;

/** Sample every authored property on a clip without adding defaults for
 * properties that have no track. */
export function sampleClipAnimations(
  clip: Pick<TimelineClip, "animations">,
  localTimeUs: string,
): SampledClipAnimations {
  const sampled: SampledClipAnimations = {};
  for (const track of clip.animations ?? []) {
    sampled[track.property] = sampleAnimationTrack(track, localTimeUs);
  }
  return sampled;
}
