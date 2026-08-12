import { z } from "zod";
import {
  clipPlaybackRateSchema,
  microsecondStringSchema,
} from "./primitives.js";
import type { TimelineClip } from "./entities.js";

/**
 * Speed ramps: a clip whose rate changes partway through.
 *
 * **Stepped, not smooth, and that is the design rather than a shortcut.** A
 * continuously interpolated rate makes source position the *integral* of the
 * rate, so resolving a timeline instant back to a source instant means solving
 * a quadratic — irrational results, on a model whose promise is that the same
 * clip resolves to the same source microsecond on every machine. Constant
 * rational rates between boundaries keep every step exact BigInt arithmetic, in
 * both directions, which is the same reason `clipPlaybackRateSchema` is a
 * rational and not a float.
 *
 * **Segments are anchored in source time.** A source offset does not move when
 * a rate changes; every *timeline* offset after a changed segment does. Anchor
 * there and a single edit rewrites every later segment, and the inverse has to
 * carry them all.
 *
 * Offsets are relative to the clip's own `sourceInUs`, so trimming the clip
 * does not renumber the ramp.
 */

export const speedSegmentSchema = z
  .object({
    id: z.string().min(1),
    /** Microseconds from the clip's `sourceInUs`, as a canonical decimal
     * string. The first segment is always at "0". */
    sourceOffsetUs: microsecondStringSchema,
    /** Same rational, same bounds and same lowest-terms rule as a constant
     * clip rate — one speed keeps one spelling wherever it is written. */
    rate: clipPlaybackRateSchema,
  })
  .strict();

export type SpeedSegment = z.infer<typeof speedSegmentSchema>;

/**
 * A clip's ramp: at least two segments, the first at offset zero, offsets
 * strictly increasing, ids unique.
 *
 * At least two because one rate for the whole clip is `playbackRate`, which
 * already has a spelling — two ways to say one thing would be two
 * byte-different projects that render identically, and canonical JSON treats
 * those as different projects.
 */
export const speedRampSchema = z
  .array(speedSegmentSchema)
  .min(2, "a ramp needs at least two segments; one rate is playbackRate")
  .superRefine((segments, ctx) => {
    if (segments[0] !== undefined && segments[0].sourceOffsetUs !== "0") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "the first segment must start at offset 0",
        path: [0, "sourceOffsetUs"],
      });
    }
    const ids = new Set<string>();
    let previous: bigint | undefined;
    segments.forEach((segment, index) => {
      if (ids.has(segment.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "segment ids must be unique within a ramp",
          path: [index, "id"],
        });
      }
      ids.add(segment.id);

      const offset = BigInt(segment.sourceOffsetUs);
      if (previous !== undefined && offset <= previous) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "segment offsets must be strictly increasing",
          path: [index, "sourceOffsetUs"],
        });
      }
      previous = offset;
    });
  });

export type SpeedRamp = z.infer<typeof speedRampSchema>;

/** How much timeline a source span occupies at one rate. Exact: the rate is a
 * rational, so this is integer arithmetic throughout. */
function stretch(
  sourceSpan: bigint,
  rate: { numerator: number; denominator: number },
): bigint {
  return (sourceSpan * BigInt(rate.denominator)) / BigInt(rate.numerator);
}

/**
 * The timeline duration a ramped clip occupies, summed segment by segment.
 *
 * Summed rather than derived from an average, because the sum is what the
 * playback map actually walks — an average would drift from it by the rounding
 * of every segment it smoothed over.
 */
export function rampTimelineDurationUs(
  ramp: SpeedRamp,
  sourceInUs: string,
  sourceOutUs: string,
): string {
  const span = BigInt(sourceOutUs) - BigInt(sourceInUs);
  let total = 0n;
  ramp.forEach((segment, index) => {
    const from = BigInt(segment.sourceOffsetUs);
    const next = ramp[index + 1];
    const to = next === undefined ? span : BigInt(next.sourceOffsetUs);
    if (to > from) total += stretch(to - from, segment.rate);
  });
  return total.toString();
}

/**
 * A ramp's segments as spans on both clocks at once: where each begins and how
 * long it lasts, in timeline microseconds and in source microseconds.
 *
 * Audio needs this and picture does not. A frame is resolved one instant at a
 * time, so `sourceAtClipOffset` answers it; but a sound is *scheduled* as a
 * span — `AudioBufferSourceNode.start(when, offset, duration)` takes a source
 * offset and a source duration, and one node can only carry one rate. A ramped
 * clip is therefore one node per segment, and this is the list to walk.
 *
 * Returns a single whole-clip span when the clip has no ramp, so callers have
 * one shape to handle rather than two paths.
 */
export function rampSpans(clip: TimelineClip): Array<{
  timelineOffsetUs: string;
  timelineDurationUs: string;
  sourceOffsetUs: string;
  sourceDurationUs: string;
  rate: { numerator: number; denominator: number };
}> {
  const sourceIn = BigInt(clip.sourceInUs);
  const span = BigInt(clip.sourceOutUs) - sourceIn;
  const ramp = clip.speedRamp;
  if (ramp === undefined) {
    return [
      {
        timelineOffsetUs: "0",
        timelineDurationUs: clip.timelineDurationUs,
        sourceOffsetUs: clip.sourceInUs,
        sourceDurationUs: span.toString(),
        rate: clip.playbackRate,
      },
    ];
  }
  const spans = [];
  let timelineSoFar = 0n;
  for (let i = 0; i < ramp.length; i += 1) {
    const segment = ramp[i]!;
    const from = BigInt(segment.sourceOffsetUs);
    const next = ramp[i + 1];
    const to = next === undefined ? span : BigInt(next.sourceOffsetUs);
    if (to <= from) continue;
    const timelineSpan = stretch(to - from, segment.rate);
    spans.push({
      timelineOffsetUs: timelineSoFar.toString(),
      timelineDurationUs: timelineSpan.toString(),
      sourceOffsetUs: (sourceIn + from).toString(),
      sourceDurationUs: (to - from).toString(),
      rate: segment.rate,
    });
    timelineSoFar += timelineSpan;
  }
  return spans;
}

/**
 * The rate in force `offset` into a clip's time on the timeline.
 *
 * For the live monitor, which drives one `HTMLMediaElement` per clip and can
 * only hold one rate at a time: it re-reads this as the playhead crosses a
 * boundary rather than scheduling anything in advance.
 */
export function rateAtClipOffset(
  clip: TimelineClip,
  offset: bigint,
): { numerator: number; denominator: number } {
  const spans = rampSpans(clip);
  for (const span of spans) {
    const from = BigInt(span.timelineOffsetUs);
    if (offset >= from && offset < from + BigInt(span.timelineDurationUs)) {
      return span.rate;
    }
  }
  return spans[spans.length - 1]?.rate ?? clip.playbackRate;
}

/**
 * The source instant a clip shows `offset` microseconds into its time on the
 * timeline — the one function every renderer, the scrubber and the exporter
 * must agree on.
 *
 * Walks the segments accumulating timeline time until it finds the one the
 * offset lands in, then advances into it at that segment's rate. Every step is
 * exact, and the result is monotonic, so the picture never runs backwards at a
 * seam.
 *
 * A clip with no ramp takes the constant-rate path, which is what every caller
 * did before ramps existed.
 */
export function sourceAtClipOffset(clip: TimelineClip, offset: bigint): bigint {
  const sourceIn = BigInt(clip.sourceInUs);
  const ramp = clip.speedRamp;
  if (ramp === undefined) {
    return (
      sourceIn +
      (offset * BigInt(clip.playbackRate.numerator)) /
        BigInt(clip.playbackRate.denominator)
    );
  }

  const span = BigInt(clip.sourceOutUs) - sourceIn;
  let timelineSoFar = 0n;
  for (let i = 0; i < ramp.length; i += 1) {
    const segment = ramp[i]!;
    const from = BigInt(segment.sourceOffsetUs);
    const next = ramp[i + 1];
    const to = next === undefined ? span : BigInt(next.sourceOffsetUs);
    if (to <= from) continue;
    const segmentTimeline = stretch(to - from, segment.rate);
    if (offset < timelineSoFar + segmentTimeline) {
      const into = offset - timelineSoFar;
      const advanced =
        (into * BigInt(segment.rate.numerator)) /
        BigInt(segment.rate.denominator);
      // Never past the segment's own end: the division above truncates, but a
      // caller asking for the last microsecond of a segment must not be handed
      // the first frame of the next one.
      const within = advanced < to - from ? advanced : to - from;
      return sourceIn + from + within;
    }
    timelineSoFar += segmentTimeline;
  }
  // Past the end. Callers resolve on a half-open range so this is defensive,
  // and it must not run off into source the clip does not own.
  return sourceIn + span;
}
