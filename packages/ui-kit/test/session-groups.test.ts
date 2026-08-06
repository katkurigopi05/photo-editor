import { describe, expect, it } from "vitest";
import { EditorSession } from "../src/session.js";
import {
  buildAddClip,
  buildAddTrack,
  buildCreateProject,
  buildCreateSequence,
  buildDeleteClip,
  buildMoveClip,
  buildRegisterAsset,
} from "../src/commands.js";
import type { CommandContext } from "../src/commands.js";

/**
 * Gesture grouping.
 *
 * A ripple delete is one gesture but several commands: the delete, then a move
 * per clip that follows it. The command engine's contract is one command, one
 * inverse, one version — grouping must not weaken that, so it lives here in the
 * session as a record of which operations belonged to one gesture, and undo
 * walks back through the group using the ordinary engine undo.
 */

const SEQUENCE_ID = "sequence-1";
const TRACK_ID = "track-1";

let counter = 0;
const ctx = (session: EditorSession): CommandContext => {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    baseVersion: session.getVersion(),
    createdAt: "2026-08-05T00:00:00.000Z",
    actor: { type: "user", id: "user-1" },
  };
};

function seededSession(): EditorSession {
  const session = new EditorSession();
  session.dispatch(
    buildCreateProject(ctx(session), {
      projectId: "project-1",
      ownerId: "owner-1",
      name: "Demo",
      settings: { defaultFrameRate: { numerator: 30, denominator: 1 } },
    }),
  );
  session.dispatch(
    buildRegisterAsset(ctx(session), {
      asset: {
        id: "asset-1",
        projectId: "project-1",
        kind: "video",
        originalUri: "file:///clip.mov",
        checksum: "0".repeat(64),
        metadata: { fileSizeBytes: "1000", durationUs: "10000000" },
        createdAt: "2026-08-05T00:00:00.000Z",
      },
    }),
  );
  session.dispatch(
    buildCreateSequence(ctx(session), {
      sequence: {
        id: SEQUENCE_ID,
        name: "Main",
        width: 1920,
        height: 1080,
        frameRate: { numerator: 30, denominator: 1 },
      },
    }),
  );
  session.dispatch(
    buildAddTrack(ctx(session), {
      sequenceId: SEQUENCE_ID,
      track: { id: TRACK_ID, kind: "video", name: "V1", index: 0 },
    }),
  );
  for (const [id, start] of [
    ["clip-a", "0"],
    ["clip-b", "1000000"],
    ["clip-c", "2000000"],
  ] as const) {
    session.dispatch(
      buildAddClip(ctx(session), {
        sequenceId: SEQUENCE_ID,
        trackId: TRACK_ID,
        clip: {
          id,
          assetId: "asset-1",
          timelineStartUs: start,
          sourceInUs: "0",
          sourceOutUs: "1000000",
          playbackRate: { numerator: 1, denominator: 1 },
        },
      }),
    );
  }
  session.clearHistory();
  return session;
}

const clipStarts = (session: EditorSession): Record<string, string> => {
  const track = session.getProject()!.sequences[0]!.tracks[0]!;
  return Object.fromEntries(
    track.clips.map((clip) => [clip.id, clip.timelineStartUs]),
  );
};

/** The commands a ripple delete of clip-a produces. */
function rippleDelete(session: EditorSession): void {
  session.beginGesture();
  session.dispatch(
    buildDeleteClip(ctx(session), {
      sequenceId: SEQUENCE_ID,
      clipId: "clip-a",
    }),
  );
  session.dispatch(
    buildMoveClip(ctx(session), {
      sequenceId: SEQUENCE_ID,
      clipId: "clip-b",
      targetTrackId: TRACK_ID,
      timelineStartUs: "0",
    }),
  );
  session.dispatch(
    buildMoveClip(ctx(session), {
      sequenceId: SEQUENCE_ID,
      clipId: "clip-c",
      targetTrackId: TRACK_ID,
      timelineStartUs: "1000000",
    }),
  );
  session.endGesture();
}

describe("gesture grouping", () => {
  it("still records one operation per command", () => {
    const session = seededSession();
    rippleDelete(session);
    // The engine's log is untouched by grouping: three commands, three entries.
    expect(session.getState().operationLog).toHaveLength(3);
  });

  it("undoes the whole gesture in one step", () => {
    const session = seededSession();
    const before = clipStarts(session);
    rippleDelete(session);
    expect(clipStarts(session)).toEqual({
      "clip-b": "0",
      "clip-c": "1000000",
    });

    expect(session.undo()).toBe(true);
    expect(clipStarts(session)).toEqual(before);
    expect(session.canUndo()).toBe(false);
  });

  it("redoes the whole gesture in one step", () => {
    const session = seededSession();
    rippleDelete(session);
    const after = clipStarts(session);
    session.undo();
    expect(session.redo()).toBe(true);
    expect(clipStarts(session)).toEqual(after);
  });

  it("leaves ungrouped commands as single undo steps", () => {
    const session = seededSession();
    session.dispatch(
      buildMoveClip(ctx(session), {
        sequenceId: SEQUENCE_ID,
        clipId: "clip-c",
        targetTrackId: TRACK_ID,
        timelineStartUs: "5000000",
      }),
    );
    expect(clipStarts(session)["clip-c"]).toBe("5000000");
    session.undo();
    expect(clipStarts(session)["clip-c"]).toBe("2000000");
  });

  it("does not group commands dispatched after the gesture ends", () => {
    const session = seededSession();
    rippleDelete(session);
    session.dispatch(
      buildMoveClip(ctx(session), {
        sequenceId: SEQUENCE_ID,
        clipId: "clip-c",
        targetTrackId: TRACK_ID,
        timelineStartUs: "6000000",
      }),
    );

    session.undo(); // just the move
    expect(clipStarts(session)["clip-c"]).toBe("1000000");
    session.undo(); // the whole ripple
    expect(clipStarts(session)).toEqual({
      "clip-a": "0",
      "clip-b": "1000000",
      "clip-c": "2000000",
    });
  });

  it("drops a gesture whose commands all failed, so undo skips nothing", () => {
    const session = seededSession();
    session.beginGesture();
    session.dispatch({ commandType: "nonsense" });
    session.endGesture();
    expect(session.canUndo()).toBe(false);
  });

  it("clearHistory forgets the groups too", () => {
    const session = seededSession();
    rippleDelete(session);
    session.clearHistory();
    expect(session.canUndo()).toBe(false);
    expect(session.undo()).toBe(false);
  });
});
