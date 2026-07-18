import { describe, expect, it } from "vitest";
import { canonicalStringify } from "@director/canonical-json";
import type { ProjectCommand } from "@director/command-schema";
import {
  executeCommand,
  redo,
  replay,
  undo,
  type CommandErrorCode,
  type EditorState,
  type ProjectOperation,
} from "../src/index.js";
import {
  addClipCommand,
  baseTimelineState,
  IDS,
  mustExecute,
  T,
} from "./fixtures.js";

const USER = { type: "user", id: "user-1" } as const;

const EID = {
  a: "10000000-0000-4000-8000-0000000000a1",
  b: "10000000-0000-4000-8000-0000000000a2",
  c: "10000000-0000-4000-8000-0000000000a3",
  d: "10000000-0000-4000-8000-0000000000a4",
} as const;

/** Base state with one video clip `clip-1`, at version 5. */
function clipState(): EditorState {
  return mustExecute(
    baseTimelineState(),
    addClipCommand({ id: IDS.cmd5, createdAt: T.t5, baseVersion: 4 }),
  ).state;
}

function addEffect(opts: {
  id: string;
  createdAt: string;
  baseVersion: number;
  effectId: string;
  type?: string;
  params?: Record<string, unknown>;
  clipId?: string;
  sequenceId?: string;
}): ProjectCommand {
  return {
    id: opts.id,
    commandType: "timeline.add_effect",
    baseVersion: opts.baseVersion,
    actor: USER,
    createdAt: opts.createdAt,
    payload: {
      sequenceId: opts.sequenceId ?? "sequence-1",
      clipId: opts.clipId ?? "clip-1",
      effect: {
        id: opts.effectId,
        type: opts.type ?? "color.brightness",
        enabled: true,
        params: opts.params ?? { amount: 0.5 },
      },
    },
  } as ProjectCommand;
}

function effectsOf(state: EditorState, clipId = "clip-1") {
  const clip = state.project?.sequences[0]?.tracks[0]?.clips.find(
    (c) => c.id === clipId,
  );
  return clip?.effects ?? [];
}

function expectError(
  state: EditorState,
  input: unknown,
  code: CommandErrorCode,
) {
  const result = executeCommand(state, input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

describe("clip creation", () => {
  it("creates a clip with an empty effect stack", () => {
    expect(effectsOf(clipState())).toEqual([]);
  });
});

describe("add_effect", () => {
  it("adds each effect type with valid params", () => {
    let state = clipState();
    const cases: Array<[string, Record<string, unknown>]> = [
      ["color.brightness", { amount: -0.5 }],
      ["color.contrast", { amount: 1.2 }],
      ["transform.opacity", { opacity: 0.8 }],
      ["blur.gaussian", { radiusPx: 4 }],
    ];
    let version = 5;
    const ids = [EID.a, EID.b, EID.c, EID.d];
    cases.forEach(([type, params], i) => {
      state = mustExecute(
        state,
        addEffect({
          id: IDS.cmd6,
          createdAt: T.t6,
          baseVersion: version,
          effectId: ids[i]!,
          type,
          params,
        }),
      ).state;
      version += 1;
    });
    expect(effectsOf(state).map((e) => e.type)).toEqual(cases.map((c) => c[0]));
  });

  it("rejects out-of-range params at the Zod boundary", () => {
    expectError(
      clipState(),
      addEffect({
        id: IDS.cmd6,
        createdAt: T.t6,
        baseVersion: 5,
        effectId: EID.a,
        type: "color.brightness",
        params: { amount: 5 },
      }),
      "VALIDATION_ERROR",
    );
  });

  it("rejects an unknown params key (strict)", () => {
    expectError(
      clipState(),
      addEffect({
        id: IDS.cmd6,
        createdAt: T.t6,
        baseVersion: 5,
        effectId: EID.a,
        params: { amount: 0.5, extra: 1 },
      }),
      "VALIDATION_ERROR",
    );
  });

  it("rejects a duplicate effect id on the same clip", () => {
    const state = mustExecute(
      clipState(),
      addEffect({
        id: IDS.cmd6,
        createdAt: T.t6,
        baseVersion: 5,
        effectId: EID.a,
      }),
    ).state;
    expectError(
      state,
      addEffect({
        id: IDS.cmd7,
        createdAt: T.t7,
        baseVersion: 6,
        effectId: EID.a,
      }),
      "DUPLICATE_ID",
    );
  });

  it("returns CLIP_NOT_FOUND / SEQUENCE_NOT_FOUND", () => {
    expectError(
      clipState(),
      addEffect({
        id: IDS.cmd6,
        createdAt: T.t6,
        baseVersion: 5,
        effectId: EID.a,
        clipId: "ghost",
      }),
      "CLIP_NOT_FOUND",
    );
    expectError(
      clipState(),
      addEffect({
        id: IDS.cmd6,
        createdAt: T.t6,
        baseVersion: 5,
        effectId: EID.a,
        sequenceId: "ghost",
      }),
      "SEQUENCE_NOT_FOUND",
    );
  });
});

describe("update_effect_params", () => {
  function withEffect(): EditorState {
    return mustExecute(
      clipState(),
      addEffect({
        id: IDS.cmd6,
        createdAt: T.t6,
        baseVersion: 5,
        effectId: EID.a,
        params: { amount: 0.5 },
      }),
    ).state;
  }

  const updateCmd = (params: Record<string, unknown>): ProjectCommand =>
    ({
      id: IDS.cmd7,
      commandType: "timeline.update_effect_params",
      baseVersion: 6,
      actor: USER,
      createdAt: T.t7,
      payload: {
        sequenceId: "sequence-1",
        clipId: "clip-1",
        effectId: EID.a,
        params,
      },
    }) as ProjectCommand;

  it("updates params, and undo restores the previous params", () => {
    const state = withEffect();
    const beforeParams = canonicalStringify(effectsOf(state)[0]?.params);
    const updated = mustExecute(state, updateCmd({ amount: -0.25 }));
    expect(effectsOf(updated.state)[0]?.params).toEqual({ amount: -0.25 });

    const undone = undo(updated.state);
    expect(undone.ok).toBe(true);
    if (undone.ok) {
      expect(canonicalStringify(effectsOf(undone.state)[0]?.params)).toBe(
        beforeParams,
      );
    }
  });

  it("validates new params against the effect's type", () => {
    expectError(withEffect(), updateCmd({ amount: 99 }), "VALIDATION_ERROR");
  });

  it("returns EFFECT_NOT_FOUND for a missing effect", () => {
    const state = withEffect();
    expectError(
      state,
      {
        id: IDS.cmd7,
        commandType: "timeline.update_effect_params",
        baseVersion: 6,
        actor: USER,
        createdAt: T.t7,
        payload: {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          effectId: EID.b,
          params: { amount: 0 },
        },
      },
      "EFFECT_NOT_FOUND",
    );
  });
});

describe("remove_effect and reorder_effects", () => {
  function threeEffects(): EditorState {
    let state = clipState();
    const ids = [EID.a, EID.b, EID.c];
    const cmds = [IDS.cmd6, IDS.cmd7, IDS.cmd8];
    const times = [T.t6, T.t7, T.t8];
    ids.forEach((effectId, i) => {
      state = mustExecute(
        state,
        addEffect({
          id: cmds[i]!,
          createdAt: times[i]!,
          baseVersion: 5 + i,
          effectId,
        }),
      ).state;
    });
    return state;
  }

  it("remove then undo restores the effect at its exact index", () => {
    const state = threeEffects();
    const before = canonicalStringify(effectsOf(state));
    const removed = mustExecute(state, {
      id: "20000000-0000-4000-8000-000000000001",
      commandType: "timeline.remove_effect",
      baseVersion: 8,
      actor: USER,
      createdAt: "2026-02-01T00:00:00.000Z",
      payload: { sequenceId: "sequence-1", clipId: "clip-1", effectId: EID.b },
    });
    expect(effectsOf(removed.state).map((e) => e.id)).toEqual([EID.a, EID.c]);

    const undone = undo(removed.state);
    expect(undone.ok).toBe(true);
    if (undone.ok) {
      expect(canonicalStringify(effectsOf(undone.state))).toBe(before);
      expect(effectsOf(undone.state).map((e) => e.id)).toEqual([
        EID.a,
        EID.b,
        EID.c,
      ]);
    }
  });

  const reorderCmd = (order: string[]): ProjectCommand =>
    ({
      id: "20000000-0000-4000-8000-000000000002",
      commandType: "timeline.reorder_effects",
      baseVersion: 8,
      actor: USER,
      createdAt: "2026-02-02T00:00:00.000Z",
      payload: { sequenceId: "sequence-1", clipId: "clip-1", order },
    }) as ProjectCommand;

  it("reorders and undo restores the previous order", () => {
    const state = threeEffects();
    const reordered = mustExecute(state, reorderCmd([EID.c, EID.a, EID.b]));
    expect(effectsOf(reordered.state).map((e) => e.id)).toEqual([
      EID.c,
      EID.a,
      EID.b,
    ]);
    const undone = undo(reordered.state);
    expect(undone.ok).toBe(true);
    if (undone.ok) {
      expect(effectsOf(undone.state).map((e) => e.id)).toEqual([
        EID.a,
        EID.b,
        EID.c,
      ]);
    }
  });

  it("rejects a non-permutation order", () => {
    const state = threeEffects();
    expectError(state, reorderCmd([EID.a, EID.a, EID.b]), "DUPLICATE_ID");
    expectError(state, reorderCmd([EID.a, EID.b, "ghost"]), "EFFECT_NOT_FOUND");
    expectError(state, reorderCmd([EID.a, EID.b]), "VALIDATION_ERROR");
  });
});

describe("history and replay with effects", () => {
  function buildChainWithEffects(): {
    state: EditorState;
    operations: ProjectOperation[];
  } {
    let state = clipState();
    const operations = [...state.operationLog];
    const steps: ProjectCommand[] = [
      addEffect({
        id: IDS.cmd6,
        createdAt: T.t6,
        baseVersion: 5,
        effectId: EID.a,
        params: { amount: 0.3 },
      }),
      addEffect({
        id: IDS.cmd7,
        createdAt: T.t7,
        baseVersion: 6,
        effectId: EID.b,
        type: "transform.opacity",
        params: { opacity: 0.5 },
      }),
      {
        id: IDS.cmd8,
        commandType: "timeline.update_effect_params",
        baseVersion: 7,
        actor: USER,
        createdAt: T.t8,
        payload: {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          effectId: EID.a,
          params: { amount: -0.9 },
        },
      } as ProjectCommand,
      {
        id: "20000000-0000-4000-8000-000000000003",
        commandType: "timeline.reorder_effects",
        baseVersion: 8,
        actor: USER,
        createdAt: "2026-03-01T00:00:00.000Z",
        payload: {
          sequenceId: "sequence-1",
          clipId: "clip-1",
          order: [EID.b, EID.a],
        },
      } as ProjectCommand,
    ];
    for (const cmd of steps) {
      const r = mustExecute(state, cmd);
      operations.push(r.operation);
      state = r.state;
    }
    return { state, operations };
  }

  it("replays to byte-identical state after a JSON round trip", () => {
    const { state, operations } = buildChainWithEffects();
    const roundTripped = JSON.parse(JSON.stringify(operations)) as unknown[];
    const result = replay(roundTripped);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(canonicalStringify(result.state)).toBe(canonicalStringify(state));
    }
  });

  it("undo then redo round-trips each effect command", () => {
    const { state } = buildChainWithEffects();
    // Undo all four effect operations, then redo them; end state must match.
    const finalCanon = canonicalStringify(state);
    let s = state;
    for (let i = 0; i < 4; i++) {
      const u = undo(s);
      expect(u.ok).toBe(true);
      if (u.ok) s = u.state;
    }
    for (let i = 0; i < 4; i++) {
      const r = redo(s);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.state;
    }
    expect(canonicalStringify(s)).toBe(finalCanon);
  });

  it("detects a tampered effect inverse on replay", () => {
    const { operations } = buildChainWithEffects();
    const clone = JSON.parse(JSON.stringify(operations)) as ProjectOperation[];
    const op = clone.find(
      (o) => o.inverse.commandType === "internal.set_effect_params",
    );
    expect(op).toBeDefined();
    if (op && op.inverse.commandType === "internal.set_effect_params") {
      op.inverse.payload.params = { amount: 0.123 };
    }
    const result = replay(clone);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OPERATION_LOG_INVALID");
  });
});
