import { describe, expect, it } from "vitest";
import type { Project, TimelineClip } from "@director/project-schema";
import { planExport } from "../src/index.js";
import { mp4Preset, twoSecondProject } from "./fixtures.js";

/**
 * The export plan is the only thing the encoder is allowed to read, so
 * everything the mixdown needs has to be in it: not just gain and pan, but the
 * clip's audio effects and the fades that the clip's neighbours imply. A plan
 * that omitted them would export a mix that does not match what was monitored,
 * which is exactly the class of bug the plan exists to prevent.
 */

function withAudioClips(clips: TimelineClip[]): Project {
  const project = twoSecondProject();
  return {
    ...project,
    sequences: project.sequences.map((sequence) => ({
      ...sequence,
      tracks: sequence.tracks.map((track) =>
        track.kind === "audio" ? { ...track, clips } : track,
      ),
    })),
  };
}

const audioClip = (
  id: string,
  startUs: string,
  durationUs: string,
  effects: TimelineClip["effects"] = [],
): TimelineClip => ({
  id,
  assetId: `asset-${id}`,
  trackId: "track-a1",
  timelineStartUs: startUs,
  timelineDurationUs: durationUs,
  sourceInUs: "0",
  sourceOutUs: durationUs,
  playbackRate: { numerator: 1, denominator: 1 },
  audioGainDb: 0,
  audioPan: 0,
  effects,
});

const plan = (project: Project) => {
  const result = planExport(project, "sequence-1", mp4Preset);
  if (!result.ok) throw new Error(result.error.message);
  return result.plan;
};

describe("audio clips in the export plan", () => {
  it("carries the clip's audio effects", () => {
    const effects = [
      {
        id: "fx-eq",
        type: "audio.eq" as const,
        enabled: true,
        params: { lowGainDb: 3, midGainDb: 0, highGainDb: -2 },
      },
    ];
    const placements = plan(
      withAudioClips([audioClip("a", "0", "2000000", effects)]),
    ).audioClips;
    expect(placements[0]!.effects).toEqual(effects);
  });

  it("omits visual effects from the audio placement", () => {
    const effects = [
      {
        id: "fx-blur",
        type: "blur.gaussian" as const,
        enabled: true,
        params: { radiusPx: 4 },
      },
    ] as TimelineClip["effects"];
    const placements = plan(
      withAudioClips([audioClip("a", "0", "2000000", effects)]),
    ).audioClips;
    expect(placements[0]!.effects).toEqual([]);
  });

  it("resolves an authored fade", () => {
    const effects = [
      {
        id: "fx-fade",
        type: "audio.fade" as const,
        enabled: true,
        params: { fadeInUs: "500000", fadeOutUs: "250000" },
      },
    ];
    const placements = plan(
      withAudioClips([audioClip("a", "0", "2000000", effects)]),
    ).audioClips;
    expect(placements[0]!.fades.fadeInUs).toBe("500000");
    expect(placements[0]!.fades.fadeOutUs).toBe("250000");
  });

  it("resolves the crossfade implied by two overlapping clips", () => {
    const placements = plan(
      withAudioClips([
        audioClip("a", "0", "2000000"),
        audioClip("b", "1500000", "2000000"),
      ]),
    ).audioClips;

    const first = placements.find((p) => p.clipId === "a")!;
    const second = placements.find((p) => p.clipId === "b")!;
    // The outgoing tail and the incoming head cover the same 0.5s.
    expect(first.fades.fadeOutUs).toBe("500000");
    expect(first.fades.fadeOutFromOverlap).toBe(true);
    expect(second.fades.fadeInUs).toBe("500000");
    expect(second.fades.fadeInFromOverlap).toBe(true);
  });

  it("stays deterministic for the same project", () => {
    const project = withAudioClips([
      audioClip("a", "0", "2000000"),
      audioClip("b", "1500000", "2000000"),
    ]);
    expect(plan(project)).toEqual(plan(project));
  });
});
