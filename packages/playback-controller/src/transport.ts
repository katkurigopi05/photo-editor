import type { Rational } from "@director/project-schema";

/**
 * Playback transport state and its pure reducers.
 *
 * IMPORTANT (Foundation non-negotiable): playback state — current time,
 * play/pause, loop region, rate — is UI/session state. It is deliberately kept
 * out of `Project`, the command engine, and the operation log, so undo/redo and
 * replay semantics are untouched by playback. `tick` advances by a
 * caller-supplied delta; nothing here reads the clock.
 */

export interface LoopRegion {
  startUs: string;
  endUs: string;
}

export interface PlaybackState {
  currentTimeUs: string;
  playing: boolean;
  /** Playback speed multiplier (1/1 = real time). Applied exactly to ticks.
   * A magnitude only — the sign lives in `direction`. */
  rate: Rational;
  /**
   * Which way time runs: 1 forward, -1 backwards.
   *
   * Separate from `rate` rather than folded into it as a sign. `rate` is a
   * Rational that the exact tick arithmetic multiplies and divides by, and it
   * is asserted positive on the way in; making it signed would put a sign into
   * every one of those operations and into every consumer that reads it.
   */
  direction: 1 | -1;
  loopRegion: LoopRegion | null;
  /** The playable duration bound; seeking and ticking clamp to this. */
  durationUs: string;
}

const UNIT_RATE: Rational = { numerator: 1, denominator: 1 };

export function createPlaybackState(
  durationUs: string,
  rate: Rational = UNIT_RATE,
): PlaybackState {
  assertPositiveRate(rate);
  return {
    currentTimeUs: "0",
    playing: false,
    rate: { numerator: rate.numerator, denominator: rate.denominator },
    direction: 1,
    loopRegion: null,
    durationUs,
  };
}

function assertPositiveRate(rate: Rational): void {
  if (rate.numerator <= 0 || rate.denominator <= 0) {
    throw new RangeError("playback rate must be positive");
  }
}

function clamp(t: bigint, lo: bigint, hi: bigint): bigint {
  if (t < lo) return lo;
  if (t > hi) return hi;
  return t;
}

export function play(state: PlaybackState): PlaybackState {
  return { ...state, playing: true };
}

export function pause(state: PlaybackState): PlaybackState {
  return { ...state, playing: false };
}

export function seek(state: PlaybackState, timeUs: string): PlaybackState {
  const clamped = clamp(BigInt(timeUs), 0n, BigInt(state.durationUs));
  return { ...state, currentTimeUs: clamped.toString() };
}

/** Set which way time runs. */
export function setDirection(
  state: PlaybackState,
  direction: 1 | -1,
): PlaybackState {
  if (direction !== 1 && direction !== -1) {
    throw new RangeError("direction must be 1 or -1");
  }
  return { ...state, direction };
}

export function setRate(state: PlaybackState, rate: Rational): PlaybackState {
  assertPositiveRate(rate);
  return {
    ...state,
    rate: { numerator: rate.numerator, denominator: rate.denominator },
  };
}

export function setLoopRegion(
  state: PlaybackState,
  region: LoopRegion | null,
): PlaybackState {
  if (region === null) return { ...state, loopRegion: null };
  const start = BigInt(region.startUs);
  const end = BigInt(region.endUs);
  if (!(start < end)) {
    throw new RangeError("loop region start must be strictly less than end");
  }
  if (start < 0n || end > BigInt(state.durationUs)) {
    throw new RangeError("loop region must be within [0, duration]");
  }
  return {
    ...state,
    loopRegion: { startUs: region.startUs, endUs: region.endUs },
  };
}

/**
 * Advance playback by a nonnegative delta (microseconds). No-op when paused.
 * Wraps within an active loop region; otherwise stops (pauses) at the duration.
 */
export function tick(state: PlaybackState, deltaUs: string): PlaybackState {
  if (!state.playing) return state;
  const delta = BigInt(deltaUs);
  if (delta < 0n) throw new RangeError("deltaUs must be nonnegative");

  const advance =
    (delta * BigInt(state.rate.numerator)) / BigInt(state.rate.denominator);
  // The magnitude is computed exactly as before; only the sign is new, so
  // forward playback is arithmetically untouched by reverse existing.
  const signed = state.direction === -1 ? -advance : advance;
  const next = BigInt(state.currentTimeUs) + signed;

  if (state.loopRegion !== null) {
    const start = BigInt(state.loopRegion.startUs);
    const end = BigInt(state.loopRegion.endUs);
    const span = end - start;
    if (state.direction === -1) {
      // Wraps end→start, the mirror of forward. Without this a loop becomes a
      // one-way trip the moment you shuttle back through its start.
      if (next < start) {
        const behind = (start - next) % span;
        const wrapped = behind === 0n ? start : end - behind;
        return { ...state, currentTimeUs: wrapped.toString() };
      }
      return { ...state, currentTimeUs: next.toString() };
    }
    if (next >= end) {
      const wrapped = start + ((next - start) % span);
      return { ...state, currentTimeUs: wrapped.toString() };
    }
    return { ...state, currentTimeUs: next.toString() };
  }

  if (state.direction === -1) {
    // Time before the start of the sequence does not exist, and a negative
    // microsecond string would reach every consumer of currentTimeUs.
    if (next <= 0n) return { ...state, currentTimeUs: "0", playing: false };
    return { ...state, currentTimeUs: next.toString() };
  }

  const duration = BigInt(state.durationUs);
  if (next >= duration) {
    return { ...state, currentTimeUs: duration.toString(), playing: false };
  }
  return { ...state, currentTimeUs: next.toString() };
}
