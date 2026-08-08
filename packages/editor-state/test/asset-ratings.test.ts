import { describe, expect, it } from "vitest";
import { canonicalStringify, deepFreeze } from "@director/canonical-json";
import {
  executeCommand,
  replay,
  undo,
  redo,
  type EditorState,
} from "../src/index.js";
import { baseTimelineState, IDS, T } from "./fixtures.js";

const USER = { type: "user", id: "user-1" } as const;

function ratingOf(state: EditorState): string | undefined {
  return state.project?.assets[0]?.rating;
}

function setRating(
  state: EditorState,
  rating: "favorite" | "rejected" | null,
  id: string = IDS.cmd5,
  createdAt: string = T.t5,
) {
  return executeCommand(state, {
    id,
    commandType: "asset.set_rating",
    baseVersion: state.project?.currentVersion ?? 0,
    actor: USER,
    createdAt,
    payload: { assetId: "asset-1", rating },
  });
}

describe("asset.set_rating", () => {
  it("sets, replaces, and clears the optional rating", () => {
    let state = baseTimelineState();
    const favorite = setRating(state, "favorite");
    expect(favorite.ok).toBe(true);
    if (!favorite.ok) return;
    state = favorite.state;
    expect(ratingOf(state)).toBe("favorite");

    const rejected = setRating(state, "rejected", IDS.cmd6, T.t6);
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    state = rejected.state;
    expect(ratingOf(state)).toBe("rejected");

    const cleared = setRating(state, null, IDS.cmd7, T.t7);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(ratingOf(cleared.state)).toBeUndefined();
    expect(cleared.state.project?.assets[0]).not.toHaveProperty("rating");
  });

  it("undoes and redoes byte-exactly", () => {
    const before = baseTimelineState();
    const changed = setRating(before, "favorite");
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;

    const undone = undo(changed.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(canonicalStringify(undone.state.project)).toBe(
      canonicalStringify(before.project),
    );

    const redone = redo(undone.state);
    expect(redone.ok).toBe(true);
    if (redone.ok) expect(ratingOf(redone.state)).toBe("favorite");
  });

  it("replays through a JSON round trip to byte-equivalent state", () => {
    const changed = setRating(baseTimelineState(), "rejected");
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const operations = JSON.parse(
      JSON.stringify(changed.state.operationLog),
    ) as unknown[];
    const replayed = replay(operations);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) {
      expect(canonicalStringify(replayed.state)).toBe(
        canonicalStringify(changed.state),
      );
    }
  });

  it("rejects a missing asset without changing frozen state", () => {
    const before = deepFreeze(baseTimelineState());
    const snapshot = canonicalStringify(before);
    const result = executeCommand(before, {
      id: IDS.cmd5,
      commandType: "asset.set_rating",
      baseVersion: 4,
      actor: USER,
      createdAt: T.t5,
      payload: { assetId: "missing", rating: "favorite" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ASSET_NOT_FOUND");
    expect(canonicalStringify(before)).toBe(snapshot);
  });
});
