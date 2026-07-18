import type { Project, TimelineClip } from "@director/project-schema";
import type { ExportPreset } from "../src/index.js";

function clip(
  id: string,
  trackId: string,
  startUs: string,
  durationUs: string,
): TimelineClip {
  return {
    id,
    assetId: `asset-${id}`,
    trackId,
    timelineStartUs: startUs,
    timelineDurationUs: durationUs,
    sourceInUs: "0",
    sourceOutUs: durationUs,
    playbackRate: { numerator: 1, denominator: 1 },
    audioGainDb: 0,
    audioPan: 0,
    effects: [],
  };
}

/** A project with one 2-second video clip and one 2-second audio clip. */
export function twoSecondProject(): Project {
  return {
    id: "project-1",
    ownerId: "owner-1",
    name: "Demo",
    schemaVersion: 1,
    currentVersion: 6,
    settings: { defaultFrameRate: { numerator: 30, denominator: 1 } },
    assets: [],
    sequences: [
      {
        id: "sequence-1",
        name: "Main",
        width: 1920,
        height: 1080,
        frameRate: { numerator: 30, denominator: 1 },
        tracks: [
          {
            id: "track-v1",
            kind: "video",
            name: "V1",
            index: 0,
            clips: [clip("clip-v", "track-v1", "0", "2000000")],
          },
          {
            id: "track-a1",
            kind: "audio",
            name: "A1",
            index: 1,
            clips: [clip("clip-a", "track-a1", "0", "2000000")],
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-06T00:00:00.000Z",
  };
}

export const mp4Preset: ExportPreset = {
  width: 1920,
  height: 1080,
  frameRate: { numerator: 30, denominator: 1 },
  videoCodec: "h264",
  container: "mp4",
  videoBitrateKbps: 8000,
  audioCodec: "aac",
  audioSampleRate: 48000,
};
