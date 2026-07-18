import { canonicalStringify } from "@director/canonical-json";
import {
  projectCommandSchema,
  projectOperationSchema,
  type ProjectCommand,
  type ProjectOperation,
} from "@director/command-schema";
import { makeError, zodError } from "./errors.js";
import { applyForward, applyInverse } from "./reducers.js";
import type {
  CommandResult,
  EditorState,
  HistoryResult,
  ReplayResult,
} from "./types.js";

/** A fresh, empty editor state. */
export function createEditorState(): EditorState {
  return {
    project: null,
    operationLog: [],
    undoStack: [],
    redoStack: [],
  };
}

function buildOperation(
  command: ProjectCommand,
  inverse: ProjectOperation["inverse"],
): ProjectOperation {
  return {
    id: command.id,
    baseVersion: command.baseVersion,
    resultingVersion: command.baseVersion + 1,
    command,
    inverse,
    createdAt: command.createdAt,
  };
}

/**
 * Validate and apply a public command. On success returns a new state with the
 * operation appended and the redo branch cleared. On any expected domain
 * failure returns `ok: false` with the prior state unchanged (never throws).
 */
export function executeCommand(
  state: EditorState,
  commandInput: unknown,
): CommandResult {
  // Reject internal command types arriving through the public boundary.
  if (
    typeof commandInput === "object" &&
    commandInput !== null &&
    typeof (commandInput as { commandType?: unknown }).commandType ===
      "string" &&
    (commandInput as { commandType: string }).commandType.startsWith(
      "internal.",
    )
  ) {
    return {
      ok: false,
      state,
      error: makeError(
        "VALIDATION_ERROR",
        "internal command types are not accepted at the public boundary",
        ["commandType"],
      ),
    };
  }

  const parsed = projectCommandSchema.safeParse(commandInput);
  if (!parsed.success) {
    return { ok: false, state, error: zodError(parsed.error) };
  }
  const command = parsed.data;

  const result = applyForward(state.project, command);
  if (!result.ok) {
    return { ok: false, state, error: result.error };
  }

  const operation = buildOperation(command, result.inverse);
  const nextState: EditorState = {
    project: result.project,
    operationLog: [...state.operationLog, operation],
    undoStack: [...state.undoStack, operation],
    redoStack: [],
  };
  return { ok: true, state: nextState, operation };
}

/** Undo the most recently applied operation. */
export function undo(state: EditorState): HistoryResult {
  const operation = state.operationLog[state.operationLog.length - 1];
  if (operation === undefined) {
    return {
      ok: false,
      state,
      error: makeError("HISTORY_EMPTY", "there is nothing to undo"),
    };
  }

  let restored = applyInverse(state.project, operation.inverse);
  if (restored !== null) {
    restored = { ...restored, currentVersion: operation.baseVersion };
  }

  const nextState: EditorState = {
    project: restored,
    operationLog: state.operationLog.slice(0, -1),
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, operation],
  };
  return { ok: true, state: nextState, operation };
}

/** Redo the most recently undone operation by reapplying its forward command. */
export function redo(state: EditorState): HistoryResult {
  const operation = state.redoStack[state.redoStack.length - 1];
  if (operation === undefined) {
    return {
      ok: false,
      state,
      error: makeError("HISTORY_EMPTY", "there is nothing to redo"),
    };
  }

  const result = applyForward(state.project, operation.command);
  if (!result.ok) {
    return {
      ok: false,
      state,
      error: makeError(
        "OPERATION_LOG_INVALID",
        "redo failed to reapply a previously valid command; state is corrupt",
        undefined,
        { underlying: result.error },
      ),
    };
  }

  const nextState: EditorState = {
    project: result.project,
    operationLog: [...state.operationLog, operation],
    undoStack: [...state.undoStack, operation],
    redoStack: state.redoStack.slice(0, -1),
  };
  return { ok: true, state: nextState, operation };
}

function replayFailure(
  state: EditorState,
  operationIndex: number,
  message: string,
  details?: Record<string, unknown>,
): ReplayResult {
  return {
    ok: false,
    state,
    error: makeError("OPERATION_LOG_INVALID", message, undefined, details),
    operationIndex,
  };
}

/**
 * Reconstruct editor state from a serialized operation log, validating every
 * element's structure, chain continuity, and recorded metadata against a fresh
 * recomputation. Byte-equal canonical JSON of the recomputed inverse must match
 * the recorded inverse.
 */
export function replay(operationsInput: readonly unknown[]): ReplayResult {
  if (!Array.isArray(operationsInput)) {
    return {
      ok: false,
      state: createEditorState(),
      error: makeError("OPERATION_LOG_INVALID", "replay input is not an array"),
      operationIndex: -1,
    };
  }

  let state = createEditorState();
  let previousResultingVersion = 0;

  for (let index = 0; index < operationsInput.length; index++) {
    const parsed = projectOperationSchema.safeParse(operationsInput[index]);
    if (!parsed.success) {
      return replayFailure(state, index, "operation structure is invalid", {
        issues: parsed.error.issues.map((i) => ({
          path: [...i.path],
          message: i.message,
        })),
      });
    }
    const operation = parsed.data;

    // Chain continuity.
    if (index === 0) {
      if (operation.baseVersion !== 0) {
        return replayFailure(
          state,
          index,
          "first operation must have baseVersion 0",
        );
      }
    } else if (operation.baseVersion !== previousResultingVersion) {
      return replayFailure(
        state,
        index,
        `baseVersion ${operation.baseVersion} does not continue from ${previousResultingVersion}`,
      );
    }
    if (operation.resultingVersion !== operation.baseVersion + 1) {
      return replayFailure(
        state,
        index,
        "resultingVersion must equal baseVersion + 1",
      );
    }
    if (operation.id !== operation.command.id) {
      return replayFailure(
        state,
        index,
        "operation id does not match the embedded command id",
      );
    }
    if (operation.createdAt !== operation.command.createdAt) {
      return replayFailure(
        state,
        index,
        "operation createdAt does not match the embedded command createdAt",
      );
    }

    // Reconstruct by executing the forward command.
    const result = executeCommand(state, operation.command);
    if (!result.ok) {
      return replayFailure(
        state,
        index,
        "forward command failed during replay reconstruction",
        { underlying: result.error },
      );
    }

    // Verify recorded metadata against the recomputation.
    if (result.operation.resultingVersion !== operation.resultingVersion) {
      return replayFailure(
        state,
        index,
        "recorded resultingVersion does not match the produced version",
      );
    }
    if (
      canonicalStringify(result.operation.inverse) !==
      canonicalStringify(operation.inverse)
    ) {
      return replayFailure(
        state,
        index,
        "recorded inverse does not match the recomputed inverse",
      );
    }

    state = result.state;
    previousResultingVersion = operation.resultingVersion;
  }

  return { ok: true, state };
}
