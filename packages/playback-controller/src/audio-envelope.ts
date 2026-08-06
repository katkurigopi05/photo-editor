import type { TimelineClip } from "@director/project-schema";

/**
 * Per-clip audio fades, including the crossfades implied by same-track
 * overlaps.
 *
 * Live monitoring and the export mixdown drive two completely different audio
 * graphs (a `MediaElementSource` chain versus an `OfflineAudioContext`), so the
 * only way they can agree on what a fade sounds like is to share the maths.
 * That is all this module is: where a clip is silent, where it is at full
 * level, and the shape in between.
 *
 * The shape is equal-power (`sin`/`cos`), not linear. Two correlated sources
 * crossfading linearly lose about 3 dB in the middle of the overlap, which is
 * audible as a hole in every crossfade; equal-power keeps `in² + out² = 1`.
 */

export interface ResolvedAudioFades {
  /** Clip-local microseconds from the clip start, as a canonical string. */
  fadeInUs: string;
  /** Clip-local microseconds before the clip end, as a canonical string. */
  fadeOutUs: string;
  /** True when the ramp was implied by an overlap rather than authored. */
  fadeInFromOverlap: boolean;
  fadeOutFromOverlap: boolean;
}

const ZERO_FADES: ResolvedAudioFades = {
  fadeInUs: "0",
  fadeOutUs: "0",
  fadeInFromOverlap: false,
  fadeOutFromOverlap: false,
};

function authoredFades(clip: TimelineClip): { inUs: bigint; outUs: bigint } {
  const fx = clip.effects.find((e) => e.enabled && e.type === "audio.fade");
  if (!fx) return { inUs: 0n, outUs: 0n };
  const params = fx.params as { fadeInUs: string; fadeOutUs: string };
  return { inUs: BigInt(params.fadeInUs), outUs: BigInt(params.fadeOutUs) };
}

const clipEndUs = (clip: TimelineClip): bigint =>
  BigInt(clip.timelineStartUs) + BigInt(clip.timelineDurationUs);

/**
 * The fades that actually apply to `clip`, given its neighbours.
 *
 * `neighbours` is any set of clips to consider for overlap — callers normally
 * pass the other clips of the same track; clips on other tracks and clips that
 * do not overlap are ignored here anyway, so passing the whole sequence is
 * safe, just slower.
 *
 * An overlap always produces a ramp, so two audio clips slid over each other
 * crossfade rather than both playing at full level and clipping. An authored
 * fade that is longer than the overlap wins — asking for a 2s fade in and
 * getting 1s because a neighbour happens to overlap by 1s would be a surprise.
 */
export function resolveAudioFades(
  clip: TimelineClip,
  neighbours: readonly TimelineClip[],
): ResolvedAudioFades {
  const duration = BigInt(clip.timelineDurationUs);
  if (duration <= 0n) return ZERO_FADES;

  const start = BigInt(clip.timelineStartUs);
  const end = start + duration;
  const authored = authoredFades(clip);

  let overlapIn = 0n;
  let overlapOut = 0n;
  for (const other of neighbours) {
    if (other.id === clip.id) continue;
    if (other.trackId !== clip.trackId) continue;
    const otherStart = BigInt(other.timelineStartUs);
    const otherEnd = clipEndUs(other);
    if (otherEnd <= start || otherStart >= end) continue;

    if (otherStart <= start) {
      // Neighbour covers this clip's head: crossfade in over the shared part.
      const shared = (otherEnd < end ? otherEnd : end) - start;
      if (shared > overlapIn) overlapIn = shared;
    }
    if (otherEnd >= end) {
      const shared = end - (otherStart > start ? otherStart : start);
      if (shared > overlapOut) overlapOut = shared;
    }
  }

  let fadeIn = authored.inUs > overlapIn ? authored.inUs : overlapIn;
  let fadeOut = authored.outUs > overlapOut ? authored.outUs : overlapOut;

  // A ramp longer than the clip would never finish rising, and two ramps that
  // meet in the middle would each be cut off mid-curve. Scale them down
  // together so a symmetric request stays symmetric.
  if (fadeIn > duration) fadeIn = duration;
  if (fadeOut > duration) fadeOut = duration;
  const total = fadeIn + fadeOut;
  if (total > duration && total > 0n) {
    fadeIn = (fadeIn * duration) / total;
    fadeOut = (fadeOut * duration) / total;
  }

  return {
    fadeInUs: fadeIn.toString(),
    fadeOutUs: fadeOut.toString(),
    fadeInFromOverlap: fadeIn > 0n && overlapIn >= authored.inUs,
    fadeOutFromOverlap: fadeOut > 0n && overlapOut >= authored.outUs,
  };
}

/** Equal-power ramp: 0 at `progress` 0, 1 at `progress` 1. */
function equalPowerRamp(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return Math.sin((progress * Math.PI) / 2);
}

/**
 * The envelope gain (0..1) for one clip-local instant.
 *
 * Times are clip-local microseconds, matching the animation and transition
 * samplers, so every per-clip sampler in the codebase takes its time in the
 * same coordinate space.
 */
export function audioEnvelopeGain(
  localTimeUs: string,
  durationUs: string,
  fades: ResolvedAudioFades,
): number {
  const duration = BigInt(durationUs);
  if (duration <= 0n) return 1;

  let time = BigInt(localTimeUs);
  if (time < 0n) time = 0n;
  if (time > duration) time = duration;

  const fadeIn = BigInt(fades.fadeInUs);
  const fadeOut = BigInt(fades.fadeOutUs);

  let gain = 1;
  if (fadeIn > 0n && time < fadeIn) {
    gain = Math.min(gain, equalPowerRamp(Number(time) / Number(fadeIn)));
  }
  if (fadeOut > 0n && time > duration - fadeOut) {
    const remaining = Number(duration - time) / Number(fadeOut);
    gain = Math.min(gain, equalPowerRamp(remaining));
  }
  return gain;
}

/**
 * The envelope sampled as a curve, for audio graphs that ramp a parameter over
 * a span rather than being polled per instant (`AudioParam.setValueCurveAtTime`).
 * Same maths, so the curve and the per-instant sampler cannot drift apart.
 */
export function audioEnvelopeCurve(
  durationUs: string,
  fades: ResolvedAudioFades,
  points: number,
): Float32Array {
  const count = Math.max(2, Math.floor(points));
  const duration = BigInt(durationUs);
  const curve = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const at = (duration * BigInt(i)) / BigInt(count - 1);
    curve[i] = audioEnvelopeGain(at.toString(), durationUs, fades);
  }
  return curve;
}
