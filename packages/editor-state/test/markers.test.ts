import { describe, expect, it } from "vitest";
import { canonicalStringify } from "@director/canonical-json";
import type { ProjectCommand } from "@director/command-schema";
import {
  executeCommand,
  replay,
  undo,
  type EditorState,
} from "../src/index.js";
import {
  addClipCommand,
  baseTimelineState,
  IDS,
  mustExecute,
  T,
} from "./fixtures.js";

/**
 * Marker commands.
 *
 * The rule that matters is the one a note-taking feature is most likely to get
 * wrong: a marker's time is clip-local, so it must fall inside the clip. A
 * marker past the end would be invisible, unreachable and would survive every
 * trim — a note nobody can find is worse than no note.
 */

const USER = { type: "user", id: "user-1" } as const;

function clipState(): EditorState {
  return mustExecute(
    baseTimelineState(),
    addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
  ).state;
}

const theClip = (state: EditorState) =>
  state.project?.sequences[0]?.tracks[0]?.clips[0];

const command = (
  commandType: string,
  payload: unknown,
  overrides: Partial<{ id: string; baseVersion: number }> = {},
): ProjectCommand =>
  ({
    id: overrides.id ?? IDS.cmd6,
    commandType,
    baseVersion: overrides.baseVersion ?? 5,
    actor: USER,
    createdAt: T.t6,
    payload,
  }) as ProjectCommand;

const addMarker = (
  overrides: Partial<{
    id: string;
    baseVersion: number;
    markerId: string;
    timeUs: string;
    name: string;
    kind: string;
  }> = {},
): ProjectCommand =>
  command(
    "timeline.add_marker",
    {
      sequenceId: "sequence-1",
      clipId: "clip-1",
      marker: {
        id: overrides.markerId ?? "marker-1",
        timeUs: overrides.timeUs ?? "500000",
        name: overrides.name ?? "Cut here",
        kind: overrides.kind ?? "standard",
      },
    },
    overrides,
  );

describe("add_marker", () => {
  it("pins a marker to the clip", () => {
    const result = executeCommand(clipState(), addMarker());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(theClip(result.state)?.markers).toHaveLength(1);
    expect(theClip(result.state)?.markers?.[0]?.name).toBe("Cut here");
  });

  it("keeps markers ordered by time however they arrive", () => {
    // The list is read straight into a timeline overlay and an inspector list;
    // sorting on write means neither has to re-sort, and the operation log
    // reads in the order a person would expect.
    let state = mustExecute(clipState(), addMarker({ timeUs: "800000" })).state;
    state = mustExecute(
      state,
      addMarker({
        id: IDS.cmd7,
        baseVersion: 6,
        markerId: "marker-2",
        timeUs: "200000",
      }),
    ).state;
    expect(theClip(state)?.markers?.map((m) => m.timeUs)).toEqual([
      "200000",
      "800000",
    ]);
  });

  it("refuses a marker past the end of the clip", () => {
    const result = executeCommand(
      clipState(),
      addMarker({ timeUs: "99000000" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUT_OF_BOUNDS");
  });

  it("accepts a marker at the very start and refuses one at the very end", () => {
    // Half-open, like every other range in the model: the end instant belongs
    // to whatever comes next.
    expect(executeCommand(clipState(), addMarker({ timeUs: "0" })).ok).toBe(
      true,
    );
    const duration = theClip(clipState())!.timelineDurationUs;
    expect(
      executeCommand(clipState(), addMarker({ timeUs: duration })).ok,
    ).toBe(false);
  });

  it("rejects a duplicate marker id", () => {
    const state = mustExecute(clipState(), addMarker()).state;
    const result = executeCommand(
      state,
      addMarker({ id: IDS.cmd7, baseVersion: 6 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DUPLICATE_ID");
  });

  it("undoes back to a clip with no markers field at all", () => {
    const before = clipState();
    const result = executeCommand(before, addMarker());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const undone = undo(result.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(canonicalStringify(undone.state.project)).toBe(
      canonicalStringify(before.project),
    );
  });
});

describe("update_marker", () => {
  it("renames, moves and ticks a marker", () => {
    const state = mustExecute(clipState(), addMarker({ kind: "todo" })).state;
    const result = executeCommand(
      state,
      command(
        "timeline.update_marker",
        {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          markerId: "marker-1",
          timeUs: "750000",
          name: "Fix the audio",
          done: true,
        },
        { id: IDS.cmd7, baseVersion: 6 },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const marker = theClip(result.state)?.markers?.[0];
    expect(marker?.name).toBe("Fix the audio");
    expect(marker?.timeUs).toBe("750000");
    expect(marker?.done).toBe(true);
  });

  it("reports a missing marker", () => {
    const result = executeCommand(
      clipState(),
      command("timeline.update_marker", {
        sequenceId: "sequence-1",
        clipId: "clip-1",
        markerId: "ghost",
        name: "nowhere",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MARKER_NOT_FOUND");
  });

  it("refuses to move a marker outside the clip", () => {
    const state = mustExecute(clipState(), addMarker()).state;
    const result = executeCommand(
      state,
      command(
        "timeline.update_marker",
        {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          markerId: "marker-1",
          timeUs: "99000000",
        },
        { id: IDS.cmd7, baseVersion: 6 },
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUT_OF_BOUNDS");
  });

  it("restores the previous marker exactly on undo", () => {
    const state = mustExecute(clipState(), addMarker()).state;
    const result = executeCommand(
      state,
      command(
        "timeline.update_marker",
        {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          markerId: "marker-1",
          name: "Renamed",
        },
        { id: IDS.cmd7, baseVersion: 6 },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const undone = undo(result.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(canonicalStringify(undone.state.project)).toBe(
      canonicalStringify(state.project),
    );
  });
});

describe("remove_marker", () => {
  it("removes it, and drops the field with the last one", () => {
    const state = mustExecute(clipState(), addMarker()).state;
    const result = executeCommand(
      state,
      command(
        "timeline.remove_marker",
        {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          markerId: "marker-1",
        },
        { id: IDS.cmd7, baseVersion: 6 },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(theClip(result.state)).not.toHaveProperty("markers");
  });

  it("reports a missing marker", () => {
    const result = executeCommand(
      clipState(),
      command("timeline.remove_marker", {
        sequenceId: "sequence-1",
        clipId: "clip-1",
        markerId: "ghost",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MARKER_NOT_FOUND");
  });
});

describe("replay", () => {
  it("reconstructs a marked project byte-for-byte", () => {
    const state = mustExecute(
      mustExecute(clipState(), addMarker()).state,
      addMarker({
        id: IDS.cmd7,
        baseVersion: 6,
        markerId: "marker-2",
        // The fixture clip is one second long; a marker past that is refused,
        // which is the rule the suite above pins.
        timeUs: "900000",
        kind: "chapter",
      }),
    ).state;
    const replayed = replay(state.operationLog);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(canonicalStringify(replayed.state.project)).toBe(
      canonicalStringify(state.project),
    );
  });
});
