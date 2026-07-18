import { canonicalStringify } from "@director/canonical-json";
import type { ProjectOperation } from "@director/command-schema";
import type { EditorState } from "./types.js";

/**
 * Provider-independent persistence contract. The serialized operation log is
 * the source of truth; full editor-state save/load is layered on top. Neither
 * save nor load may share mutable references with the caller.
 */
export interface PersistenceProvider {
  saveOperationLog(operations: readonly ProjectOperation[]): Promise<void>;
  loadOperationLog(): Promise<ProjectOperation[]>;
  saveEditorState(state: EditorState): Promise<void>;
  loadEditorState(): Promise<EditorState | null>;
}

/**
 * In-memory persistence for tests. Values are serialized on save and parsed on
 * load, so stored data never shares references with caller-owned objects.
 */
export class InMemoryPersistence implements PersistenceProvider {
  private operationLog: string | null = null;
  private editorState: string | null = null;

  saveOperationLog(operations: readonly ProjectOperation[]): Promise<void> {
    this.operationLog = canonicalStringify(operations);
    return Promise.resolve();
  }

  loadOperationLog(): Promise<ProjectOperation[]> {
    const value =
      this.operationLog === null
        ? []
        : (JSON.parse(this.operationLog) as ProjectOperation[]);
    return Promise.resolve(value);
  }

  saveEditorState(state: EditorState): Promise<void> {
    this.editorState = canonicalStringify(state);
    return Promise.resolve();
  }

  loadEditorState(): Promise<EditorState | null> {
    const value =
      this.editorState === null
        ? null
        : (JSON.parse(this.editorState) as EditorState);
    return Promise.resolve(value);
  }
}
