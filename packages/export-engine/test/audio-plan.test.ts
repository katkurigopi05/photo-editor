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

describe("audio inside a compound clip", () => {
  /** An inner sequence holding one audio clip, played by a compound clip in the
   * outer one. */
  function nested(compound: Partial<TimelineClip> = {}): Project {
    const base = twoSecondProject();
    const innerAudio = {
      id: "inner-audio",
      assetId: "asset-1",
      trackId: "inner-audio-track",
      timelineStartUs: "0",
      timelineDurationUs: "2000000",
      sourceInUs: "0",
      sourceOutUs: "2000000",
      playbackRate: { numerator: 1, denominator: 1 },
      audioGainDb: 0,
      audioPan: 0,
      effects: [],
    } as unknown as TimelineClip;

    const inner = {
      ...base.sequences[0]!,
      id: "inner",
      tracks: [
        {
          id: "inner-audio-track",
          kind: "audio" as const,
          name: "A1",
          index: 0,
          clips: [innerAudio],
        },
      ],
    };

    const compoundClip = {
      id: "compound-clip",
      assetId: "compound-asset",
      trackId: base.sequences[0]!.tracks[0]!.id,
      timelineStartUs: "500000",
      timelineDurationUs: "2000000",
      sourceInUs: "0",
      sourceOutUs: "2000000",
      playbackRate: { numerator: 1, denominator: 1 },
      audioGainDb: 0,
      audioPan: 0,
      effects: [],
      ...compound,
    } as unknown as TimelineClip;

    const outer = {
      ...base.sequences[0]!,
      tracks: base.sequences[0]!.tracks.map((track, i) =>
        i === 0 ? { ...track, clips: [compoundClip] } : { ...track, clips: [] },
      ),
    };

    return {
      ...base,
      assets: [
        ...base.assets,
        {
          id: "compound-asset",
          projectId: base.id,
          kind: "sequence",
          originalUri: "sequence:inner",
          checksum: "1".repeat(64),
          metadata: { fileSizeBytes: "0", durationUs: "2000000" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      sequences: [outer, inner],
    } as unknown as Project;
  }

  it("reaches the mixdown at all", () => {
    // Walking only the outer sequence's own tracks would leave a compound
    // clip's sound silent while its picture played.
    const result = planExport(nested(), "sequence-1", mp4Preset);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.audioClips.map((c) => c.clipId)).toContain(
      "inner-audio",
    );
  });

  it("is placed where the compound clip sits, not where it sits inside", () => {
    const result = planExport(nested(), "sequence-1", mp4Preset);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const inner = result.plan.audioClips.find(
      (c) => c.clipId === "inner-audio",
    );
    // Inner clip at 0 inside, compound clip at 0.5s outside.
    expect(inner?.timelineStartUs).toBe("500000");
  });

  it("is clipped to the part the compound clip actually plays", () => {
    // Trimming a compound clip must silence the sound it no longer shows —
    // otherwise the audio runs on under a picture that has stopped.
    const result = planExport(
      nested({
        sourceInUs: "500000",
        sourceOutUs: "1500000",
        timelineDurationUs: "1000000",
      }),
      "sequence-1",
      mp4Preset,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const inner = result.plan.audioClips.find(
      (c) => c.clipId === "inner-audio",
    );
    expect(inner?.timelineDurationUs).toBe("1000000");
    // Trimmed at the front, so it starts later in its own source too.
    expect(inner?.sourceInUs).toBe("500000");
  });
});
