import { describe, expect, it } from "vitest";
import { canonicalStringify } from "@director/canonical-json";
import type { ProjectCommand } from "@director/command-schema";
import {
  executeCommand,
  replay,
  undo,
  type EditorState,
} from "../src/index.js";
import { baseTimelineState, IDS, mustExecute, T } from "./fixtures.js";

/**
 * `asset.set_keywords`.
 *
 * One command sets the whole list, which makes the inverse exact and the undo
 * step match the gesture: adding a keyword to an asset that has three is one
 * command carrying four, not a diff that has to be replayed against whatever is
 * there now.
 */

const USER = { type: "user", id: "user-1" } as const;

const keywordsOf = (state: EditorState): string[] | undefined =>
  state.project?.assets[0]?.keywords;

const setKeywords = (
  state: EditorState,
  keywords: string[],
  id: string = IDS.cmd5,
  createdAt: string = T.t5,
): ReturnType<typeof executeCommand> =>
  executeCommand(state, {
    id,
    commandType: "asset.set_keywords",
    baseVersion: state.project?.currentVersion ?? 0,
    actor: USER,
    createdAt,
    payload: { assetId: "asset-1", keywords },
  } as ProjectCommand);

describe("asset.set_keywords", () => {
  it("sets, replaces and clears", () => {
    let state = baseTimelineState();
    const tagged = setKeywords(state, ["interview", "wide shot"]);
    expect(tagged.ok).toBe(true);
    if (!tagged.ok) return;
    state = tagged.state;
    expect(keywordsOf(state)).toEqual(["interview", "wide shot"]);

    const replaced = setKeywords(state, ["b-roll"], IDS.cmd6, T.t6);
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    state = replaced.state;
    expect(keywordsOf(state)).toEqual(["b-roll"]);

    const cleared = setKeywords(state, [], IDS.cmd7, T.t7);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    // Absent, not an empty array: canonical JSON treats those as different
    // projects, and "no keywords" is the state an untouched asset is in.
    expect(cleared.state.project?.assets[0]).not.toHaveProperty("keywords");
  });

  it("stores keywords sorted, so two orders are one project", () => {
    const result = setKeywords(baseTimelineState(), ["wide shot", "interview"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(keywordsOf(result.state)).toEqual(["interview", "wide shot"]);
  });

  it("refuses an unknown asset", () => {
    const result = executeCommand(baseTimelineState(), {
      id: IDS.cmd5,
      commandType: "asset.set_keywords",
      baseVersion: 4,
      actor: USER,
      createdAt: T.t5,
      payload: { assetId: "ghost", keywords: ["interview"] },
    } as ProjectCommand);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ASSET_NOT_FOUND");
  });

  it("refuses an unnormalized or duplicated keyword", () => {
    for (const keywords of [["Interview"], ["a", "a"], [" b "]]) {
      const result = setKeywords(baseTimelineState(), keywords);
      expect(result.ok, keywords.join(",")).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("undoes to the exact previous state", () => {
    const before = baseTimelineState();
    const result = setKeywords(before, ["interview"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const undone = undo(result.state);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(canonicalStringify(undone.state.project)).toBe(
      canonicalStringify(before.project),
    );
  });

  it("replays byte-for-byte", () => {
    const state = mustExecute(baseTimelineState(), {
      id: IDS.cmd5,
      commandType: "asset.set_keywords",
      baseVersion: 4,
      actor: USER,
      createdAt: T.t5,
      payload: { assetId: "asset-1", keywords: ["interview", "b-roll"] },
    } as ProjectCommand).state;
    const replayed = replay(state.operationLog);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(canonicalStringify(replayed.state.project)).toBe(
      canonicalStringify(state.project),
    );
  });
});
