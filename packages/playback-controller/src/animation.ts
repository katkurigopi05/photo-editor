import type {
  AnimationEasing,
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
      const eased = applyAnimationEasing(left.easing, progress);
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
