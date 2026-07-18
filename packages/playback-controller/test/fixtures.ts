import type { Sequence, TimelineClip } from "@director/project-schema";

export function clip(
  id: string,
  trackId: string,
  timelineStartUs: string,
  timelineDurationUs: string,
  sourceInUs = "0",
): TimelineClip {
  return {
    id,
    assetId: `asset-${id}`,
    trackId,
    timelineStartUs,
    timelineDurationUs,
    sourceInUs,
    sourceOutUs: (BigInt(sourceInUs) + BigInt(timelineDurationUs)).toString(),
    playbackRate: { numerator: 1, denominator: 1 },
    effects: [],
  };
}

/**
 * A sequence at 30 fps with two clips on one video track:
 *  - clip-a: [0, 1_000_000)
 *  - clip-b: [1_000_000, 2_000_000)  (adjacent), sourceIn 500_000
 */
export function twoClipSequence(): Sequence {
  return {
    id: "sequence-1",
    name: "Main",
    width: 1920,
    height: 1080,
    frameRate: { numerator: 30, denominator: 1 },
    tracks: [
      {
        id: "track-1",
        kind: "video",
        name: "V1",
        index: 0,
        clips: [
          clip("clip-a", "track-1", "0", "1000000"),
          clip("clip-b", "track-1", "1000000", "1000000", "500000"),
        ],
      },
    ],
  };
}
