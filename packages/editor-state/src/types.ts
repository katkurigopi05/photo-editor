import type { Project } from "@director/project-schema";
import type {
  InternalProjectCommand,
  ProjectCommand,
  ProjectOperation,
} from "@director/command-schema";

export type {
  Project,
  ProjectCommand,
  InternalProjectCommand,
  ProjectOperation,
};

export type CommandErrorCode =
  | "VALIDATION_ERROR"
  | "PROJECT_ALREADY_EXISTS"
  | "PROJECT_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "DUPLICATE_ID"
  | "ASSET_NOT_FOUND"
  | "SEQUENCE_NOT_FOUND"
  | "TRACK_NOT_FOUND"
  | "CLIP_NOT_FOUND"
  | "INCOMPATIBLE_TRACK"
  | "INVALID_TIME_RANGE"
  | "OUT_OF_BOUNDS"
  | "OVERLAP"
  | "EFFECT_NOT_FOUND"
  | "MASK_NOT_FOUND"
  | "MASK_IN_USE"
  | "ANIMATION_TRACK_NOT_FOUND"
  | "KEYFRAME_NOT_FOUND"
  | "TRANSITION_TOO_LONG"
  | "HISTORY_EMPTY"
  | "OPERATION_LOG_INVALID";

export interface CommandError {
  code: CommandErrorCode;
  message: string;
  path?: Array<string | number>;
  details?: Record<string, unknown>;
}

/**
 * The immutable editor state. `undoStack` always mirrors `operationLog` in this
 * version (reserved for future selective-undo semantics); both stay consistent.
 */
export interface EditorState {
  project: Project | null;
  operationLog: ProjectOperation[];
  undoStack: ProjectOperation[];
  redoStack: ProjectOperation[];
}

export type CommandResult =
  | { ok: true; state: EditorState; operation: ProjectOperation }
  | { ok: false; state: EditorState; error: CommandError };

export type HistoryResult =
  | { ok: true; state: EditorState; operation: ProjectOperation }
  | { ok: false; state: EditorState; error: CommandError };

export type ReplayResult =
  | { ok: true; state: EditorState }
  | {
      ok: false;
      state: EditorState;
      error: CommandError;
      operationIndex: number;
    };
