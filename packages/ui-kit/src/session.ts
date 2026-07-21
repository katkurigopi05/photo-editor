import {
  createEditorState,
  executeCommand,
  redo,
  undo,
  type CommandError,
  type EditorState,
  type Project,
  type ProjectOperation,
} from "@director/editor-state";

/**
 * The single mutation choke point for a UI. Every project change goes through
 * `dispatch`/`undo`/`redo` here — UI code never touches project state directly,
 * enforcing Rule 2 ("Commands are the only public project-mutation path").
 *
 * Session/selection/playback state (which clip is selected, current time) is
 * intentionally kept separate from the immutable project managed here.
 */
export class EditorSession {
  private state: EditorState;
  private lastError: CommandError | null = null;

  constructor(initial: EditorState = createEditorState()) {
    this.state = initial;
  }

  getState(): EditorState {
    return this.state;
  }

  /** Drop all undo/redo history, keeping the current project as an
   * un-undoable baseline. Call after seeding scaffolding (project, sequence,
   * tracks) so the user can never undo the project out of existence. Keeps
   * the invariant that `undoStack` mirrors `operationLog` (both empty). */
  clearHistory(): void {
    this.state = {
      ...this.state,
      operationLog: [],
      undoStack: [],
      redoStack: [],
    };
    this.lastError = null;
  }

  getProject(): Project | null {
    return this.state.project;
  }

  getVersion(): number {
    return this.state.project?.currentVersion ?? 0;
  }

  getLastError(): CommandError | null {
    return this.lastError;
  }

  canUndo(): boolean {
    return this.state.operationLog.length > 0;
  }

  canRedo(): boolean {
    return this.state.redoStack.length > 0;
  }

  /** Validate and apply a command. Returns the operation on success, or null on
   * an expected domain failure (retrievable via `getLastError`). */
  dispatch(command: unknown): ProjectOperation | null {
    const result = executeCommand(this.state, command);
    if (result.ok) {
      this.state = result.state;
      this.lastError = null;
      return result.operation;
    }
    this.lastError = result.error;
    return null;
  }

  undo(): boolean {
    const result = undo(this.state);
    if (result.ok) {
      this.state = result.state;
      this.lastError = null;
      return true;
    }
    this.lastError = result.error;
    return false;
  }

  redo(): boolean {
    const result = redo(this.state);
    if (result.ok) {
      this.state = result.state;
      this.lastError = null;
      return true;
    }
    this.lastError = result.error;
    return false;
  }
}
