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
  /**
   * How many logged operations each undo step covers, oldest first. Their sum
   * is always the length of the operation log: an ordinary command contributes
   * a 1, and a gesture such as a ripple delete — one keypress, several commands
   * — contributes its own size, so one Undo puts the whole thing back.
   *
   * Deliberately *not* a change to the engine: the operation log keeps one
   * command, one inverse and one version per entry, so replay and the persisted
   * log are untouched. This is session state describing which entries arrived
   * together, exactly like selection or playback state.
   */
  private undoSteps: number[] = [];
  private redoSteps: number[] = [];
  /** Commands dispatched so far inside an open gesture, or null when none. */
  private openGesture: number | null = null;

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
    this.undoSteps = [];
    this.redoSteps = [];
    this.openGesture = null;
  }

  /** Start recording the following dispatches as one undoable gesture. */
  beginGesture(): void {
    this.openGesture = 0;
  }

  /** Close the gesture. A gesture in which every command failed contributes
   * nothing, rather than an empty step that Undo would appear to skip. */
  endGesture(): void {
    if (this.openGesture !== null && this.openGesture > 0) {
      this.undoSteps.push(this.openGesture);
    }
    this.openGesture = null;
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
    if (!result.ok) {
      this.lastError = result.error;
      return null;
    }
    this.state = result.state;
    this.lastError = null;
    if (this.openGesture === null) this.undoSteps.push(1);
    else this.openGesture += 1;
    // The engine clears the redo branch on any new command, so the steps
    // recorded for those operations are dead with it.
    this.redoSteps = [];
    return result.operation;
  }

  /** Undo one step: a whole gesture when the top of the history is one,
   * otherwise a single operation. */
  undo(): boolean {
    const steps = this.undoSteps.pop() ?? 1;
    let undone = 0;
    for (let i = 0; i < steps; i++) {
      const result = undo(this.state);
      if (!result.ok) {
        this.lastError = result.error;
        break;
      }
      this.state = result.state;
      this.lastError = null;
      undone += 1;
    }
    if (undone === 0) return false;
    // A partially applied step would leave the two stacks disagreeing about
    // where the boundary is; record what actually happened.
    this.redoSteps.push(undone);
    if (undone < steps) this.undoSteps.push(steps - undone);
    return true;
  }

  /** Redo one step, restoring a whole gesture when that is what was undone. */
  redo(): boolean {
    const steps = this.redoSteps.pop() ?? 1;
    let redone = 0;
    for (let i = 0; i < steps; i++) {
      const result = redo(this.state);
      if (!result.ok) {
        this.lastError = result.error;
        break;
      }
      this.state = result.state;
      this.lastError = null;
      redone += 1;
    }
    if (redone === 0) return false;
    this.undoSteps.push(redone);
    if (redone < steps) this.redoSteps.push(steps - redone);
    return true;
  }
}
