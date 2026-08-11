import { describe, expect, it } from "vitest";
import { canonicalStringify } from "@director/canonical-json";
import type { ProjectCommand } from "@director/command-schema";
import type { AssetKeywordRange } from "@director/project-schema";
import {
  createEditorState,
  executeCommand,
  replay,
  undo,
  type EditorState,
} from "../src/index.js";
import {
  baseTimelineState,
  IDS,
  mustExecute,
  registerVideoAssetCommand,
  T,
  createProjectCommand,
} from "./fixtures.js";

/**
 * `asset.add_keyword_range`, `asset.update_keyword_range`,
 * `asset.remove_keyword_range`.
 *
 * A range is a keyword over part of a shot, in the *asset's* own coordinate
 * space. That is the whole reason it is project state rather than session
 * state, and the reason it survives being cut into clips: the fact is about the
 * media, not about any one edit of it.
 *
 * Every command's inverse restores the asset's whole range list, the same
 * bargain markers and masks strike — the list is small, and carrying it entire
 * buys exact undo, including the difference between "no ranges" and "an empty
 * list", which canonical JSON treats as different projects.
 *
 * The base fixture's asset is five seconds long.
 */

const USER = { type: "user", id: "user-1" } as const;

const range = (
  overrides: Partial<AssetKeywordRange> = {},
): AssetKeywordRange => ({
  id: "range-1",
  keyword: "interview",
  startUs: "1000000",
  endUs: "3000000",
  ...overrides,
});

const rangesOf = (state: EditorState): AssetKeywordRange[] | undefined =>
  state.project?.assets[0]?.keywordRanges;

const addRange = (
  state: EditorState,
  value: AssetKeywordRange = range(),
  id: string = IDS.cmd5,
  createdAt: string = T.t5,
  assetId = "asset-1",
): ReturnType<typeof executeCommand> =>
  executeCommand(state, {
    id,
    commandType: "asset.add_keyword_range",
    baseVersion: state.project?.currentVersion ?? 0,
    actor: USER,
    createdAt,
    payload: { assetId, range: value },
  } as ProjectCommand);

const updateRange = (
  state: EditorState,
  patch: Record<string, unknown>,
  id: string = IDS.cmd6,
  createdAt: string = T.t6,
): ReturnType<typeof executeCommand> =>
  executeCommand(state, {
    id,
    commandType: "asset.update_keyword_range",
    baseVersion: state.project?.currentVersion ?? 0,
    actor: USER,
    createdAt,
    payload: { assetId: "asset-1", rangeId: "range-1", ...patch },
  } as ProjectCommand);

const removeRange = (
  state: EditorState,
  rangeId = "range-1",
  id: string = IDS.cmd6,
  createdAt: string = T.t6,
): ReturnType<typeof executeCommand> =>
  executeCommand(state, {
    id,
    commandType: "asset.remove_keyword_range",
    baseVersion: state.project?.currentVersion ?? 0,
    actor: USER,
    createdAt,
    payload: { assetId: "asset-1", rangeId },
  } as ProjectCommand);

/** A project whose only asset is a still — no duration to range over. */
const stillImageState = (): EditorState => {
  let state = mustExecute(createEditorState(), createProjectCommand()).state;
  const register = registerVideoAssetCommand({
    id: IDS.cmd2,
    createdAt: T.t2,
    baseVersion: 1,
  });
  state = mustExecute(state, {
    ...register,
    payload: {
      asset: {
        ...(register.payload as { asset: Record<string, unknown> }).asset,
        kind: "image",
      },
    },
  } as ProjectCommand).state;
  return state;
};

describe("asset.add_keyword_range", () => {
  it("adds a range to an asset that had none", () => {
    const result = addRange(baseTimelineState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(rangesOf(result.state)).toEqual([range()]);
  });

  it("stores ranges sorted by start, so two orders are one project", () => {
    let state = mustExecute(baseTimelineState(), {
      id: IDS.cmd5,
      commandType: "asset.add_keyword_range",
      baseVersion: 4,
      actor: USER,
      createdAt: T.t5,
      payload: {
        assetId: "asset-1",
        range: range({ id: "late", startUs: "4000000", endUs: "5000000" }),
      },
    } as ProjectCommand).state;
    state = mustExecute(state, {
      id: IDS.cmd6,
      commandType: "asset.add_keyword_range",
      baseVersion: 5,
      actor: USER,
      createdAt: T.t6,
      payload: {
        assetId: "asset-1",
        range: range({ id: "early", startUs: "0", endUs: "1000000" }),
      },
    } as ProjectCommand).state;
    expect(rangesOf(state)?.map((r) => r.id)).toEqual(["early", "late"]);
  });

  it("refuses a range that runs past the end of the media", () => {
    // The asset is five seconds. A range to six would be unreachable, and
    // would survive every trim as a fact about footage that does not exist.
    const result = addRange(
      baseTimelineState(),
      range({ startUs: "4000000", endUs: "6000000" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUT_OF_BOUNDS");
  });

  it("accepts a range that ends exactly at the duration", () => {
    // Half-open: the end instant is the boundary, not a frame past it.
    const result = addRange(
      baseTimelineState(),
      range({ startUs: "4000000", endUs: "5000000" }),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a range on media with no duration", () => {
    const result = addRange(stillImageState());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUT_OF_BOUNDS");
  });

  it("refuses a duplicate id", () => {
    const first = addRange(baseTimelineState());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = addRange(
      first.state,
      range({ keyword: "b-roll" }),
      IDS.cmd6,
      T.t6,
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("DUPLICATE_ID");
  });

  it("refuses an unknown asset", () => {
    const result = addRange(
      baseTimelineState(),
      range(),
      IDS.cmd5,
      T.t5,
      "ghost",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ASSET_NOT_FOUND");
  });

  it("refuses an unnormalized keyword", () => {
    const result = addRange(
      baseTimelineState(),
      range({ keyword: "Interview" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("refuses an empty range at the schema boundary", () => {
    const result = addRange(
      baseTimelineState(),
      range({ startUs: "1000000", endUs: "1000000" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("asset.update_keyword_range", () => {
  const withRange = (): EditorState => {
    const added = addRange(baseTimelineState());
    if (!added.ok) throw new Error("fixture failed to add a range");
    return added.state;
  };

  it("moves the bounds", () => {
    const result = updateRange(withRange(), {
      startUs: "2000000",
      endUs: "4000000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(rangesOf(result.state)?.[0]).toEqual(
      range({ startUs: "2000000", endUs: "4000000" }),
    );
  });

  it("changes the keyword without touching the bounds", () => {
    const result = updateRange(withRange(), { keyword: "b-roll" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(rangesOf(result.state)?.[0]).toEqual(range({ keyword: "b-roll" }));
  });

  it("refuses a partial edit that would invert the range", () => {
    // Only `endUs` is supplied, and it lands before the stored `startUs`. The
    // schema cannot catch this — it never sees the other half — so the reducer
    // has to check the merged result, not the payload.
    const result = updateRange(withRange(), { endUs: "500000" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TIME_RANGE");
  });

  it("refuses a partial edit that would run past the media", () => {
    const result = updateRange(withRange(), { endUs: "9000000" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUT_OF_BOUNDS");
  });

  it("refuses an unknown range", () => {
    const result = updateRange(withRange(), {
      rangeId: "ghost",
      keyword: "b-roll",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("KEYWORD_RANGE_NOT_FOUND");
  });

  it("keeps the list sorted when a move reorders it", () => {
    let state = withRange();
    state = mustExecute(state, {
      id: IDS.cmd6,
      commandType: "asset.add_keyword_range",
      baseVersion: 5,
      actor: USER,
      createdAt: T.t6,
      payload: {
        assetId: "asset-1",
        range: range({ id: "range-2", startUs: "3000000", endUs: "4000000" }),
      },
    } as ProjectCommand).state;

    const moved = updateRange(
      state,
      { startUs: "4000000", endUs: "5000000" },
      IDS.cmd7,
      T.t7,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(rangesOf(moved.state)?.map((r) => r.id)).toEqual([
      "range-2",
      "range-1",
    ]);
  });
});

describe("asset.remove_keyword_range", () => {
  it("removes the member rather than leaving an empty list", () => {
    const added = addRange(baseTimelineState());
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const removed = removeRange(added.state);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.state.project?.assets[0]).not.toHaveProperty(
      "keywordRanges",
    );
  });

  it("refuses an unknown range", () => {
    const added = addRange(baseTimelineState());
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const result = removeRange(added.state, "ghost");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("KEYWORD_RANGE_NOT_FOUND");
  });
});

describe("keyword ranges through the engine", () => {
  it("undoes an add to the exact previous state", () => {
    const before = baseTimelineState();
    const added = addRange(before);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const undone = undo(added.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    // Byte-exact, which is what proves the member was removed rather than left
    // behind as an empty array.
    expect(canonicalStringify(undone.state.project)).toBe(
      canonicalStringify(before.project),
    );
  });

  it("undoes an update to the exact previous state", () => {
    const added = addRange(baseTimelineState());
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const before = added.state;
    const updated = updateRange(before, { keyword: "b-roll" });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const undone = undo(updated.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(canonicalStringify(undone.state.project)).toBe(
      canonicalStringify(before.project),
    );
  });

  it("undoes a remove, restoring the range", () => {
    const added = addRange(baseTimelineState());
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const before = added.state;
    const removed = removeRange(before);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const undone = undo(removed.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(canonicalStringify(undone.state.project)).toBe(
      canonicalStringify(before.project),
    );
  });

  it("replays byte-for-byte", () => {
    let state = mustExecute(baseTimelineState(), {
      id: IDS.cmd5,
      commandType: "asset.add_keyword_range",
      baseVersion: 4,
      actor: USER,
      createdAt: T.t5,
      payload: { assetId: "asset-1", range: range() },
    } as ProjectCommand).state;
    state = mustExecute(state, {
      id: IDS.cmd6,
      commandType: "asset.add_keyword_range",
      baseVersion: 5,
      actor: USER,
      createdAt: T.t6,
      payload: {
        assetId: "asset-1",
        range: range({
          id: "range-2",
          keyword: "b-roll",
          startUs: "0",
          endUs: "500000",
        }),
      },
    } as ProjectCommand).state;
    state = mustExecute(state, {
      id: IDS.cmd7,
      commandType: "asset.update_keyword_range",
      baseVersion: 6,
      actor: USER,
      createdAt: T.t7,
      payload: { assetId: "asset-1", rangeId: "range-1", keyword: "wide shot" },
    } as ProjectCommand).state;

    const replayed = replay(state.operationLog);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(canonicalStringify(replayed.state.project)).toBe(
      canonicalStringify(state.project),
    );
  });

  it("leaves the asset's own keyword list alone", () => {
    // The two are independent: a range does not imply the whole shot carries
    // the keyword, and tagging the shot does not range it.
    const tagged = mustExecute(baseTimelineState(), {
      id: IDS.cmd5,
      commandType: "asset.set_keywords",
      baseVersion: 4,
      actor: USER,
      createdAt: T.t5,
      payload: { assetId: "asset-1", keywords: ["interview"] },
    } as ProjectCommand).state;
    const ranged = addRange(
      tagged,
      range({ keyword: "b-roll" }),
      IDS.cmd6,
      T.t6,
    );
    expect(ranged.ok).toBe(true);
    if (!ranged.ok) return;
    expect(ranged.state.project?.assets[0]?.keywords).toEqual(["interview"]);
    expect(rangesOf(ranged.state)?.[0]?.keyword).toBe("b-roll");
  });
});
