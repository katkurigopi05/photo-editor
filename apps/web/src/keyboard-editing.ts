import type { Rational } from "@director/project-schema";

/**
 * Keyboard-first navigation and trimming.
 *
 * The decisions live here rather than inside the key handler because they are
 * the part worth testing: which speed J presses to next, which edit point Up
 * lands on, where a frame step ends up at the boundaries. A key handler that
 * calls into these is then only wiring.
 *
 * J/K/L is the shuttle every editor has had since tape. L plays forward and
 * presses faster on each press; J does the same backwards; K stops. The
 * important detail is that pressing L while running *backwards* does not jump
 * to 2× forward — it returns to a stop first, the way a shuttle wheel passes
 * through the middle. Skipping that makes the key unusable for the thing it is
 * for, which is easing up on a moment you are looking for.
 */

/** The speeds the shuttle steps through. */
export const SHUTTLE_SPEEDS: readonly number[] = [1, 2, 4, 8];

export interface Shuttle {
  playing: boolean;
  direction: 1 | -1;
  /** Speed multiplier; always one of `SHUTTLE_SPEEDS`. */
  speed: number;
}

export const STOPPED: Shuttle = { playing: false, direction: 1, speed: 1 };

/**
 * The shuttle state after a J, K or L press.
 *
 * Pressing in the direction you are already going steps up the ladder and stops
 * at the top rather than wrapping — wrapping from 8× back to 1× on a key you
 * are leaning on is indistinguishable from the key having missed.
 */
export function shuttleAfter(current: Shuttle, key: "J" | "K" | "L"): Shuttle {
  if (key === "K") return STOPPED;

  const wanted: 1 | -1 = key === "L" ? 1 : -1;
  if (!current.playing || current.direction !== wanted) {
    return { playing: true, direction: wanted, speed: 1 };
  }
  const at = SHUTTLE_SPEEDS.indexOf(current.speed);
  const next = SHUTTLE_SPEEDS[Math.min(at + 1, SHUTTLE_SPEEDS.length - 1)]!;
  return { playing: true, direction: wanted, speed: next };
}

/** The shuttle speed as an exact rational, for the transport. */
export function shuttleRate(shuttle: Shuttle): Rational {
  return { numerator: shuttle.speed, denominator: 1 };
}

/** A short label for the shuttle, e.g. `2×` or `◀ 4×`. */
export function shuttleLabel(shuttle: Shuttle): string {
  if (!shuttle.playing) return "";
  return shuttle.direction === -1 ? `◀ ${shuttle.speed}×` : `${shuttle.speed}×`;
}

/**
 * The next edit point strictly past `from`, in the given direction.
 *
 * Strictly past, so holding the key walks through the cuts instead of sticking
 * on the one under the playhead. Returns null at the ends rather than wrapping:
 * an editor stepping through cuts wants to arrive at the last one and stay
 * there, not reappear at the start.
 */
export function nextEditPoint(
  points: readonly bigint[],
  from: bigint,
  direction: 1 | -1,
): bigint | null {
  const sorted = [...points].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (direction === 1) {
    return sorted.find((point) => point > from) ?? null;
  }
  let best: bigint | null = null;
  for (const point of sorted) {
    if (point < from) best = point;
    else break;
  }
  return best;
}

/**
 * Move `frames` frames from `fromUs`, clamped to the sequence.
 *
 * Rounded to whole frames from zero rather than added to the current time, so
 * stepping does not accumulate a fraction of a frame per press and drift off
 * the grid — which shows up as a step that occasionally moves two frames.
 */
export function steppedTime(
  fromUs: bigint,
  frameDurationUs: bigint,
  frames: number,
  durationUs: bigint,
): bigint {
  if (frameDurationUs <= 0n) return fromUs;
  const current = fromUs / frameDurationUs;
  const target = current + BigInt(frames);
  const at = target * frameDurationUs;
  if (at < 0n) return 0n;
  return at > durationUs ? durationUs : at;
}

export interface TrimResult {
  /** New source-in and timeline start/duration, all in microseconds. */
  sourceInUs: bigint;
  timelineStartUs: bigint;
  timelineDurationUs: bigint;
}

/**
 * Trim a clip's head or tail to the playhead.
 *
 * `head` moves the clip's start to the playhead and pulls its source in-point
 * with it, so the frame under the playhead stays the frame under the playhead —
 * the whole point of trimming to a position rather than by an amount.
 *
 * Returns null when the playhead is not strictly inside the clip. A trim that
 * would leave nothing is not a trim, and one outside the clip has no meaning;
 * both are better refused than silently clamped to a zero-length clip, which
 * looks like the clip vanished.
 */
export function trimToPlayhead(
  clip: {
    sourceInUs: bigint;
    timelineStartUs: bigint;
    timelineDurationUs: bigint;
  },
  playheadUs: bigint,
  edge: "head" | "tail",
): TrimResult | null {
  const start = clip.timelineStartUs;
  const end = start + clip.timelineDurationUs;
  if (playheadUs <= start || playheadUs >= end) return null;

  if (edge === "head") {
    const removed = playheadUs - start;
    return {
      sourceInUs: clip.sourceInUs + removed,
      timelineStartUs: playheadUs,
      timelineDurationUs: clip.timelineDurationUs - removed,
    };
  }
  return {
    sourceInUs: clip.sourceInUs,
    timelineStartUs: start,
    timelineDurationUs: playheadUs - start,
  };
}
