import type {
  TimelineClip,
  TransitionDirection,
} from "@director/project-schema";

import { applyAnimationEasing } from "./animation.js";

/**
 * Transitions resolved to what a renderer actually needs at one instant.
 *
 * A transition is a timed opacity ramp on one end of a clip. Whether that ramp
 * reads as a dip, a cross-track crossfade or a same-track crossfade is decided
 * by what is drawn underneath it, not by anything here — so this function is
 * the whole of the transition maths, shared by preview, GIF and MP4.
 */
export interface TransitionSample {
  /** Multiplier to apply to the clip's alpha, in [0, 1]. */
  opacity: number;
  /** Colour to paint behind the clip, present only while a `dip` is running. */
  dipColorHex?: string;
  /** Horizontal offset from a slide, as a fraction of output width. Uses the
   * same normalized convention as `transform.position_x`, so the renderer
   * multiplies by canvas width exactly as it does for animation. */
  offsetX: number;
  /** Vertical offset from a slide, as a fraction of output height. */
  offsetY: number;
}

/** Unit vector for a direction, in canvas coordinates (y grows downward). */
const DIRECTION_VECTORS: Record<
  TransitionDirection,
  { readonly x: number; readonly y: number }
> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

/** Fixed-point scale for progress, so the ratio is computed in exact BigInt
 * before it ever becomes a float. Mirrors animation.ts. */
const PROGRESS_SCALE = 1_000_000_000n;

function parseLocalTime(timeUs: string): bigint {
  const time = BigInt(timeUs);
  if (time < 0n) {
    throw new RangeError("clip-local time must be nonnegative");
  }
  return time;
}

/** `elapsed / duration` as a float, computed exactly then divided once. */
function progressOf(elapsed: bigint, duration: bigint): number {
  const scaled = (elapsed * PROGRESS_SCALE) / duration;
  return Number(scaled) / Number(PROGRESS_SCALE);
}

/**
 * The opacity multiplier and dip colour for a clip at `localTimeUs`.
 *
 * The incoming ramp runs over `[0, transitionIn.durationUs)` and the outgoing
 * ramp over the matching window at the clip's end. The two multiply, so a clip
 * short enough for both ramps to meet still lands at 1 where they touch rather
 * than double-darkening.
 */
export function sampleClipTransition(
  clip: Pick<
    TimelineClip,
    "timelineDurationUs" | "transitionIn" | "transitionOut"
  >,
  localTimeUs: string,
): TransitionSample {
  const time = parseLocalTime(localTimeUs);
  let opacity = 1;
  let dipColorHex: string | undefined;
  let offsetX = 0;
  let offsetY = 0;

  const incoming = clip.transitionIn;
  if (incoming !== undefined) {
    const duration = BigInt(incoming.durationUs);
    if (time < duration) {
      const eased = applyAnimationEasing(
        incoming.easing,
        progressOf(time, duration),
      );
      if (incoming.kind === "slide") {
        // Fully offscreen at progress 0, at rest by progress 1. A slide moves
        // rather than fades, so opacity is left alone.
        const vector = DIRECTION_VECTORS[incoming.direction ?? "left"];
        offsetX += vector.x * (1 - eased);
        offsetY += vector.y * (1 - eased);
      } else {
        opacity *= eased;
        if (incoming.kind === "dip") dipColorHex = incoming.colorHex;
      }
    }
  }

  const outgoing = clip.transitionOut;
  if (outgoing !== undefined) {
    const duration = BigInt(outgoing.durationUs);
    const windowStart = BigInt(clip.timelineDurationUs) - duration;
    if (time >= windowStart) {
      const eased = applyAnimationEasing(
        outgoing.easing,
        progressOf(time - windowStart, duration),
      );
      if (outgoing.kind === "slide") {
        // Mirror image: at rest at progress 0, fully offscreen by progress 1.
        const vector = DIRECTION_VECTORS[outgoing.direction ?? "left"];
        offsetX += vector.x * eased;
        offsetY += vector.y * eased;
      } else {
        opacity *= 1 - eased;
        if (outgoing.kind === "dip") dipColorHex = outgoing.colorHex;
      }
    }
  }

  const sample: TransitionSample = { opacity, offsetX, offsetY };
  return dipColorHex === undefined ? sample : { ...sample, dipColorHex };
}
