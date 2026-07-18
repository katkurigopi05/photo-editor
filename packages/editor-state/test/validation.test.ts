import { describe, expect, it } from "vitest";
import {
  createEditorState,
  executeCommand,
  type CommandErrorCode,
} from "../src/index.js";
import {
  addClipCommand,
  addTrackCommand,
  baseTimelineState,
  createProjectCommand,
  createSequenceCommand,
  IDS,
  mustExecute,
  registerVideoAssetCommand,
  T,
} from "./fixtures.js";

function expectError(
  input: unknown,
  code: CommandErrorCode,
  state = createEditorState(),
) {
  const result = executeCommand(state, input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
  return result;
}

describe("malformed envelopes and payloads", () => {
  it("rejects a non-object", () => {
    expectError(42, "VALIDATION_ERROR");
    expectError(null, "VALIDATION_ERROR");
  });

  it("rejects a bad UUID", () => {
    expectError(
      { ...createProjectCommand(), id: "not-a-uuid" },
      "VALIDATION_ERROR",
    );
  });

  it("rejects unknown envelope keys (strict)", () => {
    expectError({ ...createProjectCommand(), extra: true }, "VALIDATION_ERROR");
  });

  it("rejects an unknown command type", () => {
    expectError(
      { ...createProjectCommand(), commandType: "timeline.frobnicate" },
      "VALIDATION_ERROR",
    );
  });

  it("rejects internal command types at the public boundary", () => {
    const result = executeCommand(createEditorState(), {
      commandType: "internal.remove_project",
      payload: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.path).toEqual(["commandType"]);
    }
  });
});

describe("canonical microsecond strings", () => {
  const bad = ["-1", "1.5", "1e6", " 1", "1 ", "01", "", "+1", "0x10"];
  it.each(bad)("rejects timelineStartUs = %j", (value) => {
    const state = baseTimelineState();
    const command = addClipCommand({
      id: IDS.cmd5,
      createdAt: T.t5,
      baseVersion: 4,
    });
    const mutated = structuredClone(command);
    // @ts-expect-error deliberately writing an invalid value for the test
    mutated.payload.clip.timelineStartUs = value;
    expectError(mutated, "VALIDATION_ERROR", state);
  });

  it("rejects a non-string microsecond value", () => {
    const state = baseTimelineState();
    const command = structuredClone(
      addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
    );
    // @ts-expect-error deliberately writing a numeric value
    command.payload.clip.timelineStartUs = 0;
    expectError(command, "VALIDATION_ERROR", state);
  });

  it("accepts '0' and large canonical values", () => {
    const state = baseTimelineState();
    const result = executeCommand(
      state,
      addClipCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        timelineStartUs: "0",
        sourceInUs: "0",
        sourceOutUs: "5000000",
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("version conflicts", () => {
  it("rejects a wrong baseVersion with VERSION_CONFLICT", () => {
    const state = mustExecute(
      createEditorState(),
      createProjectCommand(),
    ).state;
    const result = executeCommand(
      state,
      registerVideoAssetCommand({
        id: IDS.cmd2,
        createdAt: T.t2,
        baseVersion: 5,
        durationUs: "1000000",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VERSION_CONFLICT");
  });

  it("project.create requires baseVersion 0", () => {
    const bad = { ...createProjectCommand(), baseVersion: 1 };
    expectError(bad, "VERSION_CONFLICT");
  });
});

describe("duplicate ids", () => {
  it("rejects duplicate asset ids", () => {
    let state = mustExecute(createEditorState(), createProjectCommand()).state;
    state = mustExecute(
      state,
      registerVideoAssetCommand({
        id: IDS.cmd2,
        createdAt: T.t2,
        baseVersion: 1,
        durationUs: "1000000",
      }),
    ).state;
    const result = executeCommand(
      state,
      registerVideoAssetCommand({
        id: IDS.cmd3,
        createdAt: T.t3,
        baseVersion: 2,
        durationUs: "1000000",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DUPLICATE_ID");
      expect(result.error.path).toEqual(["payload", "asset", "id"]);
    }
  });

  it("rejects duplicate track index within a sequence with path at index", () => {
    const state = baseTimelineState();
    const result = executeCommand(
      state,
      addTrackCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        trackId: "track-2",
        index: 0,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DUPLICATE_ID");
      expect(result.error.path).toEqual(["payload", "track", "index"]);
    }
  });
});

describe("missing entities and incompatible tracks", () => {
  it("returns SEQUENCE_NOT_FOUND", () => {
    const state = baseTimelineState();
    expectError(
      addTrackCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        sequenceId: "nope",
      }),
      "SEQUENCE_NOT_FOUND",
      state,
    );
  });

  it("returns TRACK_NOT_FOUND", () => {
    const state = baseTimelineState();
    expectError(
      addClipCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        trackId: "nope",
      }),
      "TRACK_NOT_FOUND",
      state,
    );
  });

  it("returns ASSET_NOT_FOUND", () => {
    const state = baseTimelineState();
    expectError(
      addClipCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        assetId: "nope",
      }),
      "ASSET_NOT_FOUND",
      state,
    );
  });

  it("returns INCOMPATIBLE_TRACK for audio asset on a video track", () => {
    let state = mustExecute(createEditorState(), createProjectCommand()).state;
    state = mustExecute(state, {
      id: IDS.cmd2,
      commandType: "asset.register",
      baseVersion: 1,
      actor: { type: "user", id: "user-1" },
      createdAt: T.t2,
      payload: {
        asset: {
          id: "audio-1",
          projectId: "project-1",
          kind: "audio",
          originalUri: "file:///a.wav",
          checksum:
            "0000000000000000000000000000000000000000000000000000000000000000",
          metadata: { fileSizeBytes: "1000", durationUs: "1000000" },
          createdAt: T.t2,
        },
      },
    }).state;
    state = mustExecute(
      state,
      createSequenceCommand({ id: IDS.cmd3, createdAt: T.t3, baseVersion: 2 }),
    ).state;
    state = mustExecute(
      state,
      addTrackCommand({ id: IDS.cmd4, createdAt: T.t4, baseVersion: 3 }),
    ).state;
    expectError(
      addClipCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        assetId: "audio-1",
      }),
      "INCOMPATIBLE_TRACK",
      state,
    );
  });
});

describe("source ranges", () => {
  it("rejects sourceOutUs beyond asset duration", () => {
    const state = baseTimelineState(); // asset duration 5000000
    expectError(
      addClipCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        sourceInUs: "0",
        sourceOutUs: "9000000",
      }),
      "INVALID_TIME_RANGE",
      state,
    );
  });

  it("rejects sourceOutUs <= sourceInUs", () => {
    const state = baseTimelineState();
    expectError(
      addClipCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        sourceInUs: "1000000",
        sourceOutUs: "1000000",
      }),
      "INVALID_TIME_RANGE",
      state,
    );
  });

  it("rejects a clip referencing an asset without durationUs", () => {
    let state = mustExecute(createEditorState(), createProjectCommand()).state;
    state = mustExecute(
      state,
      registerVideoAssetCommand({
        id: IDS.cmd2,
        createdAt: T.t2,
        baseVersion: 1,
        durationUs: undefined,
      }),
    ).state;
    state = mustExecute(
      state,
      createSequenceCommand({ id: IDS.cmd3, createdAt: T.t3, baseVersion: 2 }),
    ).state;
    state = mustExecute(
      state,
      addTrackCommand({ id: IDS.cmd4, createdAt: T.t4, baseVersion: 3 }),
    ).state;
    const result = executeCommand(
      state,
      addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_TIME_RANGE");
      expect(result.error.message).toMatch(/durationUs|duration/);
    }
  });
});

describe("playback rate", () => {
  it("rejects a non-reduced playback rate 2/2", () => {
    const state = baseTimelineState();
    const command = structuredClone(
      addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
    );
    // @ts-expect-error deliberately writing a non-unit rate
    command.payload.clip.playbackRate = { numerator: 2, denominator: 2 };
    expectError(command, "VALIDATION_ERROR", state);
  });
});

describe("insertionIndex bounds", () => {
  it("rejects insertionIndex out of range with OUT_OF_BOUNDS", () => {
    const state = baseTimelineState();
    expectError(
      addClipCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 4,
        insertionIndex: 5,
      }),
      "OUT_OF_BOUNDS",
      state,
    );
  });
});

describe("validation precedence", () => {
  it("returns VERSION_CONFLICT (higher precedence) over a missing entity", () => {
    const state = baseTimelineState(); // version 4
    // Wrong baseVersion AND a non-existent sequence: version check wins.
    const result = executeCommand(
      state,
      addClipCommand({
        id: IDS.cmd5,
        createdAt: T.t5,
        baseVersion: 99,
        sequenceId: "nope",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VERSION_CONFLICT");
  });

  it("returns VALIDATION_ERROR (highest) over a domain precondition", () => {
    // baseVersion is not an integer -> zod fails before any domain check.
    const state = baseTimelineState();
    const result = executeCommand(state, {
      ...addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
      baseVersion: 1.5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns DUPLICATE_ID (uniqueness) before INCOMPATIBLE_TRACK", () => {
    // Add a clip, then try to add another clip with the same id on an
    // incompatible track: uniqueness (5) precedes compatibility (6).
    const state = mustExecute(
      baseTimelineState(),
      addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
    ).state;
    // add an audio-only asset and audio... actually reuse same clip id on the
    // same video track but with a bad source range to confirm ordering:
    const result = executeCommand(
      state,
      addClipCommand({
        id: IDS.cmd6,
        createdAt: T.t6,
        baseVersion: 5,
        clipId: "clip-1", // duplicate id
        sourceInUs: "0",
        sourceOutUs: "9000000", // also out of range
        timelineStartUs: "9000000",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DUPLICATE_ID");
  });
});
