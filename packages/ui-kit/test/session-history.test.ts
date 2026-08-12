import { describe, expect, it } from "vitest";
import {
  EditorSession,
  buildAddClip,
  buildAddTrack,
  buildCreateSequence,
  buildCreateProject,
  buildRegisterAsset,
  type CommandContext,
} from "../src/index.js";

/**
 * The history panel needs to draw the *shape* of the history, not only its
 * length: which operations belong to one gesture, where the present sits, and
 * what lies ahead on the redo branch.
 *
 * A gesture is the unit that matters. Ripple delete is a delete plus a move per
 * clip after it; adding an adjustment layer is a track, a move per clip, an
 * asset and a clip. Listing those as nine separate entries would describe the
 * engine rather than what the person did.
 */

let counter = 0;
const ctx = (baseVersion: number): CommandContext => {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    createdAt: `2026-01-01T00:00:${String(counter).padStart(2, "0")}.000Z`,
    actor: { type: "user", id: "user-1" },
    baseVersion,
  };
};

/** A session with a project, sequence and track — the scaffolding a real one
 * opens with, and which the baseline hides from history. */
function seeded(): EditorSession {
  const session = new EditorSession();
  session.dispatch(
    buildCreateProject(ctx(0), {
      projectId: "project-1",
      ownerId: "owner-1",
      name: "Demo",
      settings: { defaultFrameRate: { numerator: 30, denominator: 1 } },
    }),
  );
  session.dispatch(
    buildRegisterAsset(ctx(1), {
      asset: {
        id: "asset-1",
        projectId: "project-1",
        kind: "video",
        originalUri: "file:///a.mov",
        checksum: "0".repeat(64),
        metadata: { fileSizeBytes: "10", durationUs: "5000000" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    }),
  );
  session.dispatch(
    buildCreateSequence(ctx(2), {
      sequence: {
        id: "sequence-1",
        name: "Main",
        width: 1920,
        height: 1080,
        frameRate: { numerator: 30, denominator: 1 },
      },
    }),
  );
  session.dispatch(
    buildAddTrack(ctx(3), {
      sequenceId: "sequence-1",
      track: { id: "track-1", kind: "video", name: "V1", index: 0 },
    }),
  );
  return session;
}

const addClip = (session: EditorSession, id: string, startUs: string): void => {
  session.dispatch(
    buildAddClip(ctx(session.getVersion()), {
      sequenceId: "sequence-1",
      trackId: "track-1",
      clip: {
        id,
        assetId: "asset-1",
        timelineStartUs: startUs,
        sourceInUs: "0",
        sourceOutUs: "1000000",
        playbackRate: { numerator: 1, denominator: 1 },
      },
    }),
  );
};

describe("undoStepSizes", () => {
  it("is one entry per command when nothing is grouped", () => {
    const session = seeded();
    session.markBaseline();
    addClip(session, "clip-a", "0");
    addClip(session, "clip-b", "1000000");
    expect(session.undoStepSizes()).toEqual([1, 1]);
  });

  it("reports a gesture as one step covering its operations", () => {
    // Two clips added inside one gesture is one thing the person did, and
    // therefore one entry and one Undo.
    const session = seeded();
    session.markBaseline();
    session.beginGesture();
    addClip(session, "clip-a", "0");
    addClip(session, "clip-b", "1000000");
    session.endGesture();
    expect(session.undoStepSizes()).toEqual([2]);
  });

  it("ignores a gesture in which everything failed", () => {
    // An empty step would be an entry that Undo appears to skip over.
    const session = seeded();
    session.markBaseline();
    session.beginGesture();
    session.dispatch({ commandType: "nonsense" });
    session.endGesture();
    expect(session.undoStepSizes()).toEqual([]);
  });
});

describe("redoStepSizes", () => {
  it("gains the step that undo removed, and loses it again on redo", () => {
    const session = seeded();
    session.markBaseline();
    addClip(session, "clip-a", "0");
    addClip(session, "clip-b", "1000000");

    session.undo();
    expect(session.undoStepSizes()).toEqual([1]);
    expect(session.redoStepSizes()).toEqual([1]);

    session.redo();
    expect(session.undoStepSizes()).toEqual([1, 1]);
    expect(session.redoStepSizes()).toEqual([]);
  });

  it("keeps a gesture whole across undo and redo", () => {
    const session = seeded();
    session.markBaseline();
    session.beginGesture();
    addClip(session, "clip-a", "0");
    addClip(session, "clip-b", "1000000");
    session.endGesture();

    session.undo();
    expect(session.redoStepSizes()).toEqual([2]);
    // Both clips went, not one of them.
    expect(session.getProject()?.sequences[0]?.tracks[0]?.clips).toHaveLength(
      0,
    );
  });

  it("empties when a new command discards the redo branch", () => {
    // The engine drops the redo branch on any new command; the panel must not
    // keep drawing a future that no longer exists.
    const session = seeded();
    session.markBaseline();
    addClip(session, "clip-a", "0");
    session.undo();
    expect(session.redoStepSizes()).toHaveLength(1);

    addClip(session, "clip-b", "1000000");
    expect(session.redoStepSizes()).toEqual([]);
  });
});

describe("the two sides together describe one history", () => {
  it("keeps a constant total as the present moves along it", () => {
    // What the panel draws: a fixed list of steps and a cursor within it. If
    // the total changed while stepping, entries would appear and vanish under
    // the pointer.
    const session = seeded();
    session.markBaseline();
    addClip(session, "clip-a", "0");
    addClip(session, "clip-b", "1000000");
    addClip(session, "clip-c", "2000000");

    const total = () =>
      session.undoStepSizes().length + session.redoStepSizes().length;
    expect(total()).toBe(3);
    session.undo();
    expect(total()).toBe(3);
    session.undo();
    expect(total()).toBe(3);
    session.redo();
    expect(total()).toBe(3);
  });

  it("counts only what is above the baseline", () => {
    // Opening a project replays its whole log; none of that is the user's to
    // undo, and none of it belongs in the panel.
    const session = seeded();
    session.markBaseline();
    expect(session.undoStepSizes()).toEqual([]);
    expect(session.canUndo()).toBe(false);
  });
});
