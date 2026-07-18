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
  /** Playback speed multiplier (1/1 = real time). Applied exactly to ticks. */
  rate: Rational;
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
  const next = BigInt(state.currentTimeUs) + advance;

  if (state.loopRegion !== null) {
    const start = BigInt(state.loopRegion.startUs);
    const end = BigInt(state.loopRegion.endUs);
    if (next >= end) {
      const span = end - start;
      const wrapped = start + ((next - start) % span);
      return { ...state, currentTimeUs: wrapped.toString() };
    }
    return { ...state, currentTimeUs: next.toString() };
  }

  const duration = BigInt(state.durationUs);
  if (next >= duration) {
    return { ...state, currentTimeUs: duration.toString(), playing: false };
  }
  return { ...state, currentTimeUs: next.toString() };
}
