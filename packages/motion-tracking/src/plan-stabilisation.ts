import type { RigidTransform } from "./types.js";

/**
 * Turning measured camera motion into an anti-shake.
 *
 * `solveStabilisation` says how the camera moved between two frames. This
 * decides what to do about it, and the decision is not "undo all of it".
 *
 * A shot that is nailed perfectly rigid looks wrong: a slow pan is intentional
 * and removing it leaves the subject sliding about inside a static frame. It
 * also costs enormously more crop, because the correction has to grow without
 * bound as the camera walks away from where it started.
 *
 * So the camera's path is *smoothed* rather than flattened. What gets removed
 * is the difference between where the camera was and where a steadier version
 * of the same camera would have been — the shake — while the intended movement
 * survives.
 */

/** One measured step, from the previous sampled frame to this one. */
export interface FrameMotion {
  /** Time of this frame within the clip, in microseconds, as a decimal string —
   * the same canonical form the rest of the project uses. */
  timeUs: string;
  /** Motion since the previous entry. The first entry's transform is ignored:
   * there is nothing before it to have moved from. */
  transform: RigidTransform;
}

/** Where the camera is, relative to where it started. */
interface CameraPose {
  x: number;
  y: number;
  rotationRad: number;
  logScale: number;
}

export interface PlannedKeyframe {
  timeUs: string;
  value: number;
}

export interface PlannedTrack {
  property:
    | "transform.position_x"
    | "transform.position_y"
    | "transform.rotation"
    | "transform.scale";
  keyframes: PlannedKeyframe[];
}

export interface StabilisationPlan {
  tracks: PlannedTrack[];
  /**
   * The zoom needed to keep the exposed edges out of frame.
   *
   * Correcting a shake moves the picture, which uncovers nothing at the far
   * side. Every stabiliser pays for this in crop, and hiding that cost is how
   * you get a result with black slivers flickering at the edges. Reported so
   * the caller can apply it, warn, or refuse.
   */
  requiredScale: number;
  /** Largest correction applied, as a fraction of frame width — the number that
   * decides whether `requiredScale` is tolerable. */
  maxCorrectionFraction: number;
}

export interface StabilisationOptions {
  /**
   * How many samples either side to average over.
   *
   * Larger is steadier and lags further behind a genuine pan; smaller keeps
   * more of the original movement, including some of the shake. This is the
   * only real knob, and it is exposed rather than tuned in secret because the
   * right value depends on the shot.
   */
  smoothingRadius?: number;
  /** Frame width and height in pixels, needed because position keyframes are
   * fractions of the frame rather than pixel offsets. */
  width: number;
  height: number;
}

const DEFAULT_SMOOTHING_RADIUS = 12;

const IDENTITY_PLAN: StabilisationPlan = {
  tracks: [],
  requiredScale: 1,
  maxCorrectionFraction: 0,
};

/**
 * Accumulate per-step motion into an absolute path.
 *
 * Each step is expressed in the *previous* frame's orientation, so a rotation
 * partway through turns the axes every later translation is measured along.
 * Adding raw dx and dy would drift as soon as the camera rolls at all.
 */
function accumulate(motions: readonly FrameMotion[]): CameraPose[] {
  const path: CameraPose[] = [{ x: 0, y: 0, rotationRad: 0, logScale: 0 }];
  for (let i = 1; i < motions.length; i += 1) {
    const previous = path[i - 1]!;
    const step = motions[i]!.transform;
    const cos = Math.cos(previous.rotationRad);
    const sin = Math.sin(previous.rotationRad);
    const scale = Math.exp(previous.logScale);
    path.push({
      x: previous.x + (step.dx * cos - step.dy * sin) * scale,
      y: previous.y + (step.dx * sin + step.dy * cos) * scale,
      rotationRad: previous.rotationRad + step.rotationRad,
      // Scale compounds multiplicatively, so it is averaged in log space —
      // otherwise a 2× followed by a 0.5× averages to 1.25 rather than 1.
      logScale: previous.logScale + Math.log(step.scale > 0 ? step.scale : 1),
    });
  }
  return path;
}

/** Box-average the path, clamping at the ends rather than shortening it. */
function smooth(path: readonly CameraPose[], radius: number): CameraPose[] {
  if (radius <= 0) return [...path];
  return path.map((_, i) => {
    let x = 0;
    let y = 0;
    let rotationRad = 0;
    let logScale = 0;
    let n = 0;
    for (let j = i - radius; j <= i + radius; j += 1) {
      // Clamping repeats the end poses rather than averaging over fewer
      // samples, which would make the first and last frames noticeably less
      // stabilised than the middle.
      const k = Math.max(0, Math.min(path.length - 1, j));
      const p = path[k]!;
      x += p.x;
      y += p.y;
      rotationRad += p.rotationRad;
      logScale += p.logScale;
      n += 1;
    }
    return {
      x: x / n,
      y: y / n,
      rotationRad: rotationRad / n,
      logScale: logScale / n,
    };
  });
}

/**
 * Plan the correction for a measured shot.
 *
 * Returns keyframes ready for `update_clip_animations`: position as a fraction
 * of the frame, rotation in degrees, scale as a multiplier — the units the
 * animation schema already uses, so this needs no new command and no schema
 * change.
 */
export function planStabilisation(
  motions: readonly FrameMotion[],
  options: StabilisationOptions,
): StabilisationPlan {
  const { width, height } = options;
  const radius = options.smoothingRadius ?? DEFAULT_SMOOTHING_RADIUS;
  // Two samples give one step, which a smoothing window cannot do anything
  // with: the smoothed path equals the path and the correction is zero.
  if (motions.length < 3 || width <= 0 || height <= 0) return IDENTITY_PLAN;

  const path = accumulate(motions);
  const target = smooth(path, radius);

  const positionX: PlannedKeyframe[] = [];
  const positionY: PlannedKeyframe[] = [];
  const rotation: PlannedKeyframe[] = [];
  const scale: PlannedKeyframe[] = [];

  let maxCorrectionFraction = 0;

  for (let i = 0; i < path.length; i += 1) {
    const actual = path[i]!;
    const wanted = target[i]!;
    // The correction is where the camera *should* have been minus where it
    // was. Moving the picture by that puts the subject where the steady camera
    // would have framed it.
    const dx = wanted.x - actual.x;
    const dy = wanted.y - actual.y;
    const dRotation = wanted.rotationRad - actual.rotationRad;
    const dScale = Math.exp(wanted.logScale - actual.logScale);

    const timeUs = motions[i]!.timeUs;
    positionX.push({ timeUs, value: dx / width });
    positionY.push({ timeUs, value: dy / height });
    rotation.push({ timeUs, value: (dRotation * 180) / Math.PI });
    scale.push({ timeUs, value: dScale });

    const fraction = Math.max(Math.abs(dx) / width, Math.abs(dy) / height);
    if (fraction > maxCorrectionFraction) maxCorrectionFraction = fraction;
  }

  // Twice, because a shift of f uncovers f at one edge and the zoom has to
  // cover it on both sides to keep the centre where it was.
  const requiredScale = 1 + 2 * maxCorrectionFraction;

  return {
    tracks: [
      { property: "transform.position_x", keyframes: positionX },
      { property: "transform.position_y", keyframes: positionY },
      { property: "transform.rotation", keyframes: rotation },
      { property: "transform.scale", keyframes: scale },
    ],
    requiredScale,
    maxCorrectionFraction,
  };
}
