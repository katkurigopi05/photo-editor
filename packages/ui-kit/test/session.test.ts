import { describe, expect, it } from "vitest";
import { planPrefetch } from "@director/playback-controller";
import {
  EditorSession,
  buildAddClip,
  buildAddTrack,
  buildCreateProject,
  buildCreateSequence,
  buildRegisterAsset,
  buildTrimClip,
  type CommandContext,
} from "../src/index.js";

const actor = { type: "user", id: "user-1" } as const;
const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const ctx = (n: number, baseVersion: number): CommandContext => ({
  id: uuid(n),
  createdAt: `2026-01-${String(n).padStart(2, "0")}T00:00:00.000Z`,
  actor,
  baseVersion,
});

function seededSession(): EditorSession {
  const s = new EditorSession();
  expect(
    s.dispatch(
      buildCreateProject(ctx(1, 0), {
        projectId: "project-1",
        ownerId: "owner-1",
        name: "Demo",
        settings: { defaultFrameRate: { numerator: 30, denominator: 1 } },
      }),
    ),
  ).not.toBeNull();
  expect(
    s.dispatch(
      buildRegisterAsset(ctx(2, 1), {
        asset: {
          id: "asset-1",
          projectId: "project-1",
          kind: "video",
          originalUri: "file:///clip.mov",
          checksum:
            "0000000000000000000000000000000000000000000000000000000000000000",
          metadata: { fileSizeBytes: "1000", durationUs: "5000000" },
          createdAt: ctx(2, 1).createdAt,
        },
      }),
    ),
  ).not.toBeNull();
  expect(
    s.dispatch(
      buildCreateSequence(ctx(3, 2), {
        sequence: {
          id: "sequence-1",
          name: "Main",
          width: 1920,
          height: 1080,
          frameRate: { numerator: 30, denominator: 1 },
        },
      }),
    ),
  ).not.toBeNull();
  expect(
    s.dispatch(
      buildAddTrack(ctx(4, 3), {
        sequenceId: "sequence-1",
        track: { id: "track-1", kind: "video", name: "V1", index: 0 },
      }),
    ),
  ).not.toBeNull();
  return s;
}

describe("EditorSession end-to-end", () => {
  it("import -> add to timeline -> trim -> preview -> undo -> redo", () => {
    const s = seededSession();

    // add to timeline
    expect(
      s.dispatch(
        buildAddClip(ctx(5, 4), {
          sequenceId: "sequence-1",
          trackId: "track-1",
          clip: {
            id: "clip-1",
            assetId: "asset-1",
            timelineStartUs: "0",
            sourceInUs: "0",
            sourceOutUs: "1000000",
            playbackRate: { numerator: 1, denominator: 1 },
          },
        }),
      ),
    ).not.toBeNull();
    expect(s.getVersion()).toBe(5);

    // trim
    expect(
      s.dispatch(
        buildTrimClip(ctx(6, 5), {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          sourceInUs: "0",
          sourceOutUs: "500000",
        }),
      ),
    ).not.toBeNull();
    const trimmedClip = s.getProject()?.sequences[0]?.tracks[0]?.clips[0];
    expect(trimmedClip?.sourceOutUs).toBe("500000");
    expect(trimmedClip?.timelineDurationUs).toBe("500000");

    // "export preview": deterministic frame-request schedule for the sequence
    const sequence = s.getProject()!.sequences[0]!;
    const preview = planPrefetch(sequence, "0", "300000");
    expect(preview.length).toBeGreaterThan(0);
    expect(preview[0]?.clipId).toBe("clip-1");

    // undo the trim
    expect(s.undo()).toBe(true);
    expect(s.getProject()?.sequences[0]?.tracks[0]?.clips[0]?.sourceOutUs).toBe(
      "1000000",
    );
    expect(s.getVersion()).toBe(5);

    // redo the trim
    expect(s.redo()).toBe(true);
    expect(s.getProject()?.sequences[0]?.tracks[0]?.clips[0]?.sourceOutUs).toBe(
      "500000",
    );
    expect(s.getVersion()).toBe(6);
  });

  it("a rejected command leaves state unchanged and records the error", () => {
    const s = seededSession();
    const before = s.getVersion();
    // add a clip referencing a nonexistent track
    const op = s.dispatch(
      buildAddClip(ctx(5, 4), {
        sequenceId: "sequence-1",
        trackId: "ghost",
        clip: {
          id: "clip-x",
          assetId: "asset-1",
          timelineStartUs: "0",
          sourceInUs: "0",
          sourceOutUs: "1000000",
          playbackRate: { numerator: 1, denominator: 1 },
        },
      }),
    );
    expect(op).toBeNull();
    expect(s.getVersion()).toBe(before);
    expect(s.getLastError()?.code).toBe("TRACK_NOT_FOUND");
  });

  it("tracks canUndo/canRedo", () => {
    const s = new EditorSession();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });
});
