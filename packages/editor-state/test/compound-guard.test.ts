import { describe, expect, it } from "vitest";
import type { ProjectCommand } from "@director/command-schema";
import { executeCommand, type EditorState } from "../src/index.js";
import { baseTimelineState, IDS, mustExecute, T } from "./fixtures.js";

/**
 * A compound clip must not be able to contain the sequence it sits in.
 *
 * Resolution already refuses to recurse forever, but that is a last line: a
 * project that *holds* a cycle is a broken project, and the engine's job is to
 * make broken states unreachable rather than survivable.
 */

const USER = { type: "user", id: "user-1" } as const;

/** A project with a second sequence and a compound asset pointing at it. */
function withCompound(target: string): EditorState {
  let state = baseTimelineState();
  state = mustExecute(state, {
    id: IDS.cmd5,
    commandType: "timeline.create_sequence",
    baseVersion: 4,
    actor: USER,
    createdAt: T.t5,
    payload: {
      sequence: {
        id: "sequence-2",
        name: "Nested",
        width: 1920,
        height: 1080,
        frameRate: { numerator: 30, denominator: 1 },
      },
    },
  } as ProjectCommand).state;
  state = mustExecute(state, {
    id: IDS.cmd6,
    commandType: "asset.register",
    baseVersion: 5,
    actor: USER,
    createdAt: T.t6,
    payload: {
      asset: {
        id: "compound-1",
        projectId: "project-1",
        kind: "sequence",
        originalUri: `sequence:${target}`,
        checksum: "0".repeat(64),
        metadata: { fileSizeBytes: "0", durationUs: "5000000" },
        createdAt: T.t6,
      },
    },
  } as ProjectCommand).state;
  return state;
}

const addCompound = (
  state: EditorState,
  sequenceId: string,
): ReturnType<typeof executeCommand> =>
  executeCommand(state, {
    id: IDS.cmd7,
    commandType: "timeline.add_clip",
    baseVersion: state.project?.currentVersion ?? 0,
    actor: USER,
    createdAt: T.t7,
    payload: {
      sequenceId,
      trackId: "track-1",
      clip: {
        id: "clip-compound",
        assetId: "compound-1",
        timelineStartUs: "0",
        sourceInUs: "0",
        sourceOutUs: "2000000",
        playbackRate: { numerator: 1, denominator: 1 },
      },
    },
  } as ProjectCommand);

describe("compound clips and cycles", () => {
  it("allows a compound clip that nests a different sequence", () => {
    // The ordinary case: sequence-1 plays sequence-2.
    const result = addCompound(withCompound("sequence-2"), "sequence-1");
    expect(result.ok).toBe(true);
  });

  it("refuses a sequence placed inside itself", () => {
    const result = addCompound(withCompound("sequence-1"), "sequence-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("names the ring in the refusal", () => {
    // "cannot add this" is not actionable; which sequences form the loop is.
    const result = addCompound(withCompound("sequence-1"), "sequence-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("sequence-1");
  });

  it("refuses a longer ring", () => {
    // sequence-2 already plays sequence-1; putting sequence-2 into sequence-1
    // closes the loop even though neither clip alone is self-referential.
    let state = withCompound("sequence-1");
    const seeded = executeCommand(state, {
      id: IDS.cmd7,
      commandType: "timeline.add_track",
      baseVersion: state.project?.currentVersion ?? 0,
      actor: USER,
      createdAt: T.t7,
      payload: {
        sequenceId: "sequence-2",
        track: { id: "track-2", kind: "video", name: "V1", index: 0 },
      },
    } as ProjectCommand);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    state = seeded.state;

    const inner = executeCommand(state, {
      id: IDS.cmd8,
      commandType: "timeline.add_clip",
      baseVersion: state.project?.currentVersion ?? 0,
      actor: USER,
      createdAt: T.t8,
      payload: {
        sequenceId: "sequence-2",
        trackId: "track-2",
        clip: {
          id: "clip-inner",
          assetId: "compound-1",
          timelineStartUs: "0",
          sourceInUs: "0",
          sourceOutUs: "2000000",
          playbackRate: { numerator: 1, denominator: 1 },
        },
      },
    } as ProjectCommand);
    // sequence-2 now contains a clip playing sequence-1 — legal so far.
    expect(inner.ok).toBe(true);
    if (!inner.ok) return;

    // Registering a compound asset for sequence-2 and adding it to sequence-1
    // would close the ring.
    const registered = mustExecute(inner.state, {
      id: "00000000-0000-4000-8000-00000000000a",
      commandType: "asset.register",
      baseVersion: inner.state.project?.currentVersion ?? 0,
      actor: USER,
      createdAt: T.t8,
      payload: {
        asset: {
          id: "compound-2",
          projectId: "project-1",
          kind: "sequence",
          originalUri: "sequence:sequence-2",
          checksum: "1".repeat(64),
          metadata: { fileSizeBytes: "0", durationUs: "5000000" },
          createdAt: T.t8,
        },
      },
    } as ProjectCommand).state;

    const closing = executeCommand(registered, {
      id: "00000000-0000-4000-8000-00000000000b",
      commandType: "timeline.add_clip",
      baseVersion: registered.project?.currentVersion ?? 0,
      actor: USER,
      createdAt: T.t8,
      payload: {
        sequenceId: "sequence-1",
        trackId: "track-1",
        clip: {
          id: "clip-closing",
          assetId: "compound-2",
          timelineStartUs: "0",
          sourceInUs: "0",
          sourceOutUs: "2000000",
          playbackRate: { numerator: 1, denominator: 1 },
        },
      },
    } as ProjectCommand);
    expect(closing.ok).toBe(false);
  });
});
