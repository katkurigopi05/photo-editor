import { describe, expect, it } from "vitest";
import { canonicalStringify } from "@director/canonical-json";
import type { ProjectOperation } from "@director/command-schema";
import { createEditorState, replay, type EditorState } from "../src/index.js";
import {
  addClipCommand,
  createProjectCommand,
  createSequenceCommand,
  addTrackCommand,
  IDS,
  mustExecute,
  registerVideoAssetCommand,
  T,
} from "./fixtures.js";

const USER = { type: "user", id: "user-1" } as const;

/** Build a six-operation chain covering create/register/sequence/track/clip/move. */
function buildChain(): { state: EditorState; operations: ProjectOperation[] } {
  const operations: ProjectOperation[] = [];
  let state = createEditorState();

  let r = mustExecute(state, createProjectCommand());
  operations.push(r.operation);
  state = r.state;

  r = mustExecute(
    state,
    registerVideoAssetCommand({
      id: IDS.cmd2,
      createdAt: T.t2,
      baseVersion: 1,
      durationUs: "5000000",
    }),
  );
  operations.push(r.operation);
  state = r.state;

  r = mustExecute(
    state,
    createSequenceCommand({ id: IDS.cmd3, createdAt: T.t3, baseVersion: 2 }),
  );
  operations.push(r.operation);
  state = r.state;

  r = mustExecute(
    state,
    addTrackCommand({ id: IDS.cmd4, createdAt: T.t4, baseVersion: 3 }),
  );
  operations.push(r.operation);
  state = r.state;

  r = mustExecute(
    state,
    addClipCommand({
      id: IDS.cmd5,
      createdAt: T.t5,
      baseVersion: 4,
      sourceInUs: "0",
      sourceOutUs: "1000000",
      timelineStartUs: "0",
    }),
  );
  operations.push(r.operation);
  state = r.state;

  r = mustExecute(state, {
    id: IDS.cmd6,
    commandType: "timeline.move_clip",
    baseVersion: 5,
    actor: USER,
    createdAt: T.t6,
    payload: {
      sequenceId: "sequence-1",
      clipId: "clip-1",
      targetTrackId: "track-1",
      timelineStartUs: "2000000",
    },
  });
  operations.push(r.operation);
  state = r.state;

  return { state, operations };
}

function roundTrip(operations: ProjectOperation[]): unknown[] {
  return JSON.parse(JSON.stringify(operations)) as unknown[];
}

describe("replay", () => {
  it("reconstructs byte-identical state after a JSON round trip", () => {
    const { state, operations } = buildChain();
    const result = replay(roundTrip(operations));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(canonicalStringify(result.state)).toBe(canonicalStringify(state));
    }
  });

  it("rejects input that is not an array with operationIndex -1", () => {
    const result = replay(42 as unknown as unknown[]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("OPERATION_LOG_INVALID");
      expect(result.operationIndex).toBe(-1);
    }
  });

  it("rejects a structurally invalid operation", () => {
    const result = replay([{ not: "an operation" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.operationIndex).toBe(0);
  });
});

describe("replay rejects tampering", () => {
  function tamper(mutate: (ops: ProjectOperation[]) => void): void {
    const { operations } = buildChain();
    const clone = JSON.parse(JSON.stringify(operations)) as ProjectOperation[];
    mutate(clone);
    const result = replay(clone);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("OPERATION_LOG_INVALID");
    }
  }

  it("detects a tampered id", () => {
    tamper((ops) => {
      ops[0]!.id = IDS.cmd2;
    });
  });

  it("detects a tampered baseVersion", () => {
    tamper((ops) => {
      ops[1]!.baseVersion = 5;
    });
  });

  it("detects a tampered resultingVersion", () => {
    tamper((ops) => {
      ops[0]!.resultingVersion = 2;
    });
  });

  it("detects a tampered command", () => {
    tamper((ops) => {
      // Point the add_clip at a nonexistent track: forward fails on replay.
      const op = ops[4]!;
      if (op.command.commandType === "timeline.add_clip") {
        op.command.payload.trackId = "ghost-track";
      }
    });
  });

  it("detects a tampered inverse", () => {
    tamper((ops) => {
      const op = ops[1]!;
      if (op.inverse.commandType === "internal.remove_asset") {
        op.inverse.payload.restoreUpdatedAt = "2099-01-01T00:00:00.000Z";
      }
    });
  });
});

describe("determinism", () => {
  it("two independent executions produce identical canonical JSON", () => {
    const a = buildChain();
    const b = buildChain();
    expect(canonicalStringify(a.state)).toBe(canonicalStringify(b.state));
  });

  it("state survives a JSON serialize/parse round trip by value", () => {
    const { state } = buildChain();
    const parsed = JSON.parse(JSON.stringify(state)) as EditorState;
    expect(canonicalStringify(parsed)).toBe(canonicalStringify(state));
  });
});
