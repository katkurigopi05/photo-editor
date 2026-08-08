import {
  createEditorState,
  executeCommand,
  redo,
  replay,
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
  private baseline = 0;
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

  /**
   * Mark everything applied so far as scaffolding that Undo may not reach.
   *
   * Call after seeding the project, sequence and tracks. This *keeps* those
   * operations in the log — the log is the save format, and a log that began
   * mid-stream could not be replayed from scratch into a fresh app — while
   * putting a floor under Undo so the project cannot be popped out of
   * existence, which is what made later imports fail with "no project exists".
   */
  markBaseline(): void {
    this.baseline = this.state.operationLog.length;
    this.lastError = null;
    this.undoSteps = [];
    this.redoSteps = [];
    this.openGesture = null;
  }

  /** How many leading operations are scaffolding rather than user edits. */
  getBaseline(): number {
    return this.baseline;
  }

  /** Drop all undo/redo history *and* the log, keeping the current project as
   * an un-undoable baseline. Kept for callers that genuinely want the log
   * emptied; seeding wants `markBaseline` instead. */
  clearHistory(): void {
    this.state = {
      ...this.state,
      operationLog: [],
      undoStack: [],
      redoStack: [],
    };
    this.lastError = null;
    this.baseline = 0;
    this.undoSteps = [];
    this.redoSteps = [];
    this.openGesture = null;
  }

  /**
   * Replace everything with the state a saved operation log reconstructs.
   *
   * The log is replayed through the engine rather than trusted as state: a file
   * edited by hand, or written by a different build, fails here rather than
   * half-loading into something that cannot be exported. History is replaced
   * too — the undo stack of the session that saved the file is not this
   * session's, and offering it would undo edits the user never made here.
   */
  replaceWithOperationLog(
    operations: readonly unknown[],
    baseline = 0,
  ): { ok: true } | { ok: false; error: string } {
    const result = replay(operations);
    if (!result.ok) {
      this.lastError = result.error;
      return { ok: false, error: result.error.message };
    }
    this.state = result.state;
    // The opened project's own scaffolding stays below the floor, so Undo in
    // this session cannot delete a sequence the file arrived with.
    this.baseline = Math.min(baseline, result.state.operationLog.length);
    this.undoSteps = new Array<number>(
      Math.max(0, result.state.operationLog.length - this.baseline),
    ).fill(1);
    this.redoSteps = [];
    this.openGesture = null;
    this.lastError = null;
    return { ok: true };
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
    return this.state.operationLog.length > this.baseline;
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
    // The scaffolding below the baseline is not the user's to undo.
    if (!this.canUndo()) return false;
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
