/**
 * Offline Project Cache & Sync Engine.
 *
 * Implements Canva-style offline resilience:
 * - Persistent caching of project states and assets
 * - Offline mutation queues
 * - Network status monitoring and auto-sync resumption
 * - Conflict detection based on deterministic sequence versions
 */

export type NetworkStatus = "online" | "offline" | "syncing" | "error";

export interface QueuedProjectCommand {
  commandId: string;
  projectId: string;
  expectedVersion: number;
  commandType: string;
  payload: Record<string, unknown>;
  timestampMs: number;
}

export interface CachedProjectRecord {
  projectId: string;
  version: number;
  projectJson: string;
  lastCachedAtMs: number;
}

export interface SyncResult {
  syncedCount: number;
  failedCount: number;
  errors: readonly string[];
}

export interface OfflineStorageProvider {
  saveProject(record: CachedProjectRecord): Promise<void>;
  getProject(projectId: string): Promise<CachedProjectRecord | null>;
  queueCommand(cmd: QueuedProjectCommand): Promise<void>;
  getQueuedCommands(projectId?: string): Promise<QueuedProjectCommand[]>;
  removeQueuedCommand(commandId: string): Promise<void>;
  clearQueue(projectId?: string): Promise<void>;
}

export class MemoryOfflineStorage implements OfflineStorageProvider {
  private projects = new Map<string, CachedProjectRecord>();
  private queue: QueuedProjectCommand[] = [];

  async saveProject(record: CachedProjectRecord): Promise<void> {
    this.projects.set(record.projectId, { ...record });
  }

  async getProject(projectId: string): Promise<CachedProjectRecord | null> {
    const item = this.projects.get(projectId);
    return item ? { ...item } : null;
  }

  async queueCommand(cmd: QueuedProjectCommand): Promise<void> {
    this.queue.push({ ...cmd });
  }

  async getQueuedCommands(projectId?: string): Promise<QueuedProjectCommand[]> {
    if (!projectId) return [...this.queue];
    return this.queue.filter((c) => c.projectId === projectId);
  }

  async removeQueuedCommand(commandId: string): Promise<void> {
    this.queue = this.queue.filter((c) => c.commandId !== commandId);
  }

  async clearQueue(projectId?: string): Promise<void> {
    if (!projectId) {
      this.queue = [];
    } else {
      this.queue = this.queue.filter((c) => c.projectId !== projectId);
    }
  }
}

export class OfflineSyncEngine {
  private storage: OfflineStorageProvider;
  private status: NetworkStatus = "online";
  private statusListeners: Array<(status: NetworkStatus) => void> = [];

  constructor(
    storage: OfflineStorageProvider = new MemoryOfflineStorage(),
    initialStatus: NetworkStatus = "online",
  ) {
    this.storage = storage;
    this.status = initialStatus;
  }

  get currentStatus(): NetworkStatus {
    return this.status;
  }

  setStatus(status: NetworkStatus): void {
    if (this.status !== status) {
      this.status = status;
      for (const listener of this.statusListeners) {
        listener(status);
      }
    }
  }

  onStatusChange(listener: (status: NetworkStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  async cacheProject(
    projectId: string,
    version: number,
    projectJson: string,
    nowMs = Date.now(),
  ): Promise<void> {
    await this.storage.saveProject({
      projectId,
      version,
      projectJson,
      lastCachedAtMs: nowMs,
    });
  }

  async getCachedProject(
    projectId: string,
  ): Promise<CachedProjectRecord | null> {
    return this.storage.getProject(projectId);
  }

  async enqueueOfflineCommand(
    cmd: Omit<QueuedProjectCommand, "timestampMs">,
    nowMs = Date.now(),
  ): Promise<void> {
    await this.storage.queueCommand({
      ...cmd,
      timestampMs: nowMs,
    });
  }

  async getPendingCount(projectId?: string): Promise<number> {
    const queue = await this.storage.getQueuedCommands(projectId);
    return queue.length;
  }

  async flushSyncQueue(
    applyFn: (cmd: QueuedProjectCommand) => Promise<boolean>,
    projectId?: string,
  ): Promise<SyncResult> {
    if (this.status === "offline") {
      return { syncedCount: 0, failedCount: 0, errors: ["Cannot sync while offline."] };
    }

    this.setStatus("syncing");
    const queue = await this.storage.getQueuedCommands(projectId);
    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const cmd of queue) {
      try {
        const success = await applyFn(cmd);
        if (success) {
          await this.storage.removeQueuedCommand(cmd.commandId);
          synced += 1;
        } else {
          failed += 1;
          errors.push(`Command ${cmd.commandId} rejected by server or engine.`);
          break; // Stop sequential replay on first failure
        }
      } catch (err) {
        failed += 1;
        errors.push(
          `Error executing ${cmd.commandId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        break;
      }
    }

    if (failed > 0) {
      this.setStatus("error");
    } else {
      this.setStatus("online");
    }

    return {
      syncedCount: synced,
      failedCount: failed,
      errors,
    };
  }
}
