import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { canonicalStringify } from "@director/canonical-json";
import { replay, type EditorState } from "@director/editor-state";
import type { ProjectOperation } from "@director/command-schema";

/**
 * File-backed project storage for the MCP server.
 *
 * What lands on disk is the *operation log*, not a snapshot of the project.
 * That is the repository's existing contract (see PersistenceProvider): the
 * log is the source of truth and the project is derived from it by replay. It
 * also means a file written by this server carries the full edit history, so
 * an agent's changes stay attributable and undoable rather than arriving as an
 * opaque new state.
 *
 * The file is canonical JSON, so the same edits always produce byte-identical
 * output and diffs stay readable.
 */

/** Bumped only if the envelope around the log changes shape. */
export const PROJECT_FILE_VERSION = 1;

export interface ProjectFile {
  fileVersion: number;
  operations: ProjectOperation[];
}

export class ProjectFileError extends Error {
  constructor(
    message: string,
    readonly code:
      "FILE_UNREADABLE" | "FILE_MALFORMED" | "OPERATION_LOG_INVALID",
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ProjectFileError";
  }
}

function parseProjectFile(raw: string, path: string): ProjectFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ProjectFileError(
      `${path} is not valid JSON.`,
      "FILE_MALFORMED",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as ProjectFile).operations)
  ) {
    throw new ProjectFileError(
      `${path} is not a Director project file (expected an "operations" array).`,
      "FILE_MALFORMED",
    );
  }
  const file = parsed as ProjectFile;
  return {
    fileVersion: file.fileVersion ?? PROJECT_FILE_VERSION,
    operations: file.operations,
  };
}

/**
 * Rebuilds editor state from a project file. A missing file is not an error —
 * it is how a new project starts — but a corrupt or unreplayable one is, and
 * says which operation failed rather than silently starting empty.
 */
export async function loadProjectFile(path: string): Promise<{
  state: EditorState;
  operationCount: number;
  existed: boolean;
}> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      const empty = replay([]);
      return { state: empty.state, operationCount: 0, existed: false };
    }
    throw new ProjectFileError(
      `Could not read ${path}: ${(error as Error).message}`,
      "FILE_UNREADABLE",
    );
  }

  const file = parseProjectFile(raw, path);
  const result = replay(file.operations);
  if (!result.ok) {
    throw new ProjectFileError(
      `${path} could not be replayed: ${result.error.message} ` +
        `(operation index ${result.operationIndex}).`,
      "OPERATION_LOG_INVALID",
      { operationIndex: result.operationIndex, error: result.error },
    );
  }
  return {
    state: result.state,
    operationCount: file.operations.length,
    existed: true,
  };
}

/**
 * Writes the log through a temporary file and renames it into place. A crash
 * mid-write would otherwise leave a truncated log, which replay would reject —
 * losing the whole project rather than the last edit.
 */
export async function saveProjectFile(
  path: string,
  operations: readonly ProjectOperation[],
): Promise<void> {
  const file: ProjectFile = {
    fileVersion: PROJECT_FILE_VERSION,
    operations: [...operations],
  };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, canonicalStringify(file), "utf8");
  await rename(temporary, path);
}
