/**
 * Optical flow for Project Director — map steps A2 (motion tracking) and A3
 * (stabilisation).
 *
 * Pure functions over plain arrays. No DOM, no canvas, no WebGL: this runs
 * under Node in the unit suite, which is the only way its accuracy can be
 * checked against known ground truth rather than eyeballed.
 *
 * What this does *not* do is decide anything about a project. It measures
 * motion; turning a measurement into an edit is a command, and belongs
 * upstream.
 */

export type {
  FlowFrame,
  TrackPoint,
  TrackResult,
  RigidTransform,
} from "./types.js";

export {
  buildPyramid,
  halve,
  sampleBilinear,
  insideFrame,
  DEFAULT_LEVELS,
  MIN_LEVEL_SIZE,
} from "./pyramid.js";

export { trackPoint } from "./lucas-kanade.js";
export { solveStabilisation, samplingGrid } from "./stabilise.js";
export {
  planStabilisation,
  type FrameMotion,
  type StabilisationPlan,
  type StabilisationOptions,
  type PlannedTrack,
  type PlannedKeyframe,
} from "./plan-stabilisation.js";

import type { FlowFrame } from "./types.js";

/**
 * Convert RGBA — the format the rest of the app carries — to a luma frame.
 *
 * Rec. 601 weights. Not a plain average: the eye is far more sensitive to green
 * than to blue, and averaging makes a blue-on-black edge look like strong
 * structure the tracker will chase.
 */
export function toFlowFrame(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): FlowFrame {
  const luma = new Uint8ClampedArray(width * height);
  for (let p = 0, i = 0; p < luma.length; p += 1, i += 4) {
    luma[p] = Math.round(
      0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!,
    );
  }
  return { width, height, luma };
}
