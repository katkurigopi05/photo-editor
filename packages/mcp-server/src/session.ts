import { EditorSession, type CommandContext } from "@director/ui-kit";
import type { Project, ProjectOperation } from "@director/editor-state";

import { loadProjectFile, saveProjectFile } from "./project-store.js";

/**
 * The MCP server's hold on one project file.
 *
 * Every mutation goes through `EditorSession.dispatch`, i.e. the same validated
 * command engine the web app uses — the server has no privileged path to
 * project state, so an agent cannot produce a project the app could not have.
 *
 * Commands are stamped with an `agent` actor rather than `user`. That is
 * already part of the command envelope, and it means a project edited by an
 * AI tool records who did what: the operation log distinguishes an agent's
 * trim from a person's.
 */

export interface SessionOptions {
  /** Identifies the agent in the operation log, e.g. "mcp:claude-desktop". */
  actorId?: string;
  /** Overridable for tests; defaults to crypto.randomUUID. */
  newId?: () => string;
  /** Overridable for tests; defaults to the wall clock. */
  now?: () => string;
}

export interface DispatchOutcome {
  ok: boolean;
  version: number;
  operation?: ProjectOperation;
  error?: { code: string; message: string; details?: unknown };
}

export class ProjectSession {
  private session = new EditorSession();
  private path: string | null = null;
  private readonly actorId: string;
  private readonly newId: () => string;
  private readonly now: () => string;

  constructor(options: SessionOptions = {}) {
    this.actorId = options.actorId ?? "mcp";
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Path of the open project, or null when nothing is open. */
  getPath(): string | null {
    return this.path;
  }

  /** Throws with actionable wording rather than returning null — every tool
   * needs an open project and the message is what the agent will read. */
  requirePath(): string {
    if (this.path === null) {
      throw new Error(
        "No project is open. Call open_project with a file path first.",
      );
    }
    return this.path;
  }

  getProject(): Project | null {
    return this.session.getProject();
  }

  requireProject(): Project {
    const project = this.getProject();
    if (project === null) {
      throw new Error(
        "The open file has no project yet. Call create_project first.",
      );
    }
    return project;
  }

  getVersion(): number {
    return this.session.getVersion();
  }

  getOperations(): readonly ProjectOperation[] {
    return this.session.getState().operationLog;
  }

  canUndo(): boolean {
    return this.session.canUndo();
  }

  canRedo(): boolean {
    return this.session.canRedo();
  }

  /** Loads `path`, replacing whatever was open. */
  async open(path: string): Promise<{ existed: boolean; operations: number }> {
    const loaded = await loadProjectFile(path);
    this.session = new EditorSession(loaded.state);
    this.path = path;
    return { existed: loaded.existed, operations: loaded.operationCount };
  }

  /** The envelope fields a command needs. `baseVersion` is read at call time so
   * concurrent edits are rejected by the engine rather than silently applied. */
  context(): CommandContext {
    return {
      id: this.newId(),
      createdAt: this.now(),
      actor: { type: "agent", id: this.actorId },
      baseVersion: this.getVersion(),
    };
  }

  /**
   * Applies a command and persists on success. Persisting per command keeps
   * the file honest if the client disconnects mid-session; the log is append
   * only, so the cost is bounded by the log size rather than the project's.
   */
  async dispatch(command: unknown): Promise<DispatchOutcome> {
    const operation = this.session.dispatch(command);
    if (operation === null) {
      const error = this.session.getLastError();
      return {
        ok: false,
        version: this.getVersion(),
        error: {
          code: error?.code ?? "COMMAND_REJECTED",
          message: error?.message ?? "The command was rejected.",
          ...(error?.details === undefined ? {} : { details: error.details }),
        },
      };
    }
    await this.persist();
    return { ok: true, version: this.getVersion(), operation };
  }

  async undo(): Promise<DispatchOutcome> {
    return this.travel(() => this.session.undo(), "Nothing to undo.");
  }

  async redo(): Promise<DispatchOutcome> {
    return this.travel(() => this.session.redo(), "Nothing to redo.");
  }

  private async travel(
    move: () => boolean,
    emptyMessage: string,
  ): Promise<DispatchOutcome> {
    if (!move()) {
      const error = this.session.getLastError();
      return {
        ok: false,
        version: this.getVersion(),
        error: {
          code: error?.code ?? "HISTORY_EMPTY",
          message: error?.message ?? emptyMessage,
        },
      };
    }
    await this.persist();
    return { ok: true, version: this.getVersion() };
  }

  private async persist(): Promise<void> {
    await saveProjectFile(this.requirePath(), this.getOperations());
  }
}
