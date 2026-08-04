import { sampleAnimationTrack } from "@director/playback-controller";
import type {
  AnimationKeyframe,
  AnimationProperty,
  TimelineClip,
} from "@director/project-schema";

type AnimationClip = Pick<
  TimelineClip,
  "timelineStartUs" | "timelineDurationUs" | "animations"
>;

const DEFAULT_VALUES: Record<AnimationProperty, number> = {
  "transform.position_x": 0,
  "transform.position_y": 0,
  "transform.scale": 1,
  "transform.rotation": 0,
  "transform.opacity": 1,
};

export function clipLocalTimeForPlayhead(
  clip: AnimationClip,
  timelineTimeUs: string,
): string {
  const relative = BigInt(timelineTimeUs) - BigInt(clip.timelineStartUs);
  const duration = BigInt(clip.timelineDurationUs);
  if (relative <= 0n) return "0";
  if (relative >= duration) return duration.toString();
  return relative.toString();
}

export function animationValueAtTime(
  clip: Pick<TimelineClip, "animations">,
  property: AnimationProperty,
  localTimeUs: string,
): number {
  const track = clip.animations?.find((item) => item.property === property);
  return track
    ? sampleAnimationTrack(track, localTimeUs)
    : DEFAULT_VALUES[property];
}

export function exactKeyframeAtTime(
  clip: Pick<TimelineClip, "animations">,
  property: AnimationProperty,
  localTimeUs: string,
): AnimationKeyframe | undefined {
  return clip.animations
    ?.find((item) => item.property === property)
    ?.keyframes.find((keyframe) => keyframe.timeUs === localTimeUs);
}

export function uniqueKeyframeTimes(
  clip: Pick<TimelineClip, "animations">,
): string[] {
  const unique = new Set(
    (clip.animations ?? []).flatMap((track) =>
      track.keyframes.map((keyframe) => keyframe.timeUs),
    ),
  );
  return [...unique].sort((left, right) => {
    const leftTime = BigInt(left);
    const rightTime = BigInt(right);
    return leftTime < rightTime ? -1 : leftTime > rightTime ? 1 : 0;
  });
}

export function adjacentKeyframeTime(
  sortedTimes: readonly string[],
  currentTimeUs: string,
  direction: -1 | 1,
): string | undefined {
  const current = BigInt(currentTimeUs);
  if (direction < 0) {
    for (let index = sortedTimes.length - 1; index >= 0; index--) {
      const candidate = sortedTimes[index]!;
      if (BigInt(candidate) < current) return candidate;
    }
    return undefined;
  }
  return sortedTimes.find((candidate) => BigInt(candidate) > current);
}

export function keyframePositionPercent(
  localTimeUs: string,
  durationUs: string,
): number {
  const duration = BigInt(durationUs);
  if (duration <= 0n) return 0;
  const time = BigInt(localTimeUs);
  const clamped = time < 0n ? 0n : time > duration ? duration : time;
  return Number((clamped * 10_000n) / duration) / 100;
}
