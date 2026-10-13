/**
 * Export & Download Manager.
 *
 * Inspired by Canva's in-app Download Manager architecture (`pages/desktop_chrome_v2/download`):
 * provides an observable background download queue tracking renders, exports,
 * progress percentages, file sizes, error reporting, and history management.
 */

export type DownloadStatus = "queued" | "in-progress" | "completed" | "failed" | "canceled";

export interface DownloadItem {
  id: string;
  filename: string;
  format: string;
  fileSizeBytes?: number | undefined;
  status: DownloadStatus;
  progress: number; // 0 to 1
  error?: string | undefined;
  blobUrl?: string | undefined;
  startedAt: number;
  completedAt?: number | undefined;
}

export interface DownloadTrigger {
  (blob: Blob, filename: string): void;
}

export interface DownloadManagerDependencies {
  now?: (() => number) | undefined;
  triggerDownload?: DownloadTrigger | undefined;
  createObjectUrl?: ((blob: Blob) => string) | undefined;
  revokeObjectUrl?: ((url: string) => void) | undefined;
}

/** Formats byte counts into human-readable strings (KB, MB, GB) */
export function formatDownloadBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Browser trigger helper creating a simulated link click */
export function defaultTriggerDownload(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export class DownloadManager {
  private items: DownloadItem[] = [];
  private listeners = new Set<(items: readonly DownloadItem[]) => void>();

  constructor(private deps: DownloadManagerDependencies = {}) {}

  getItems(): readonly DownloadItem[] {
    return this.items;
  }

  getItem(id: string): DownloadItem | null {
    return this.items.find((item) => item.id === id) ?? null;
  }

  getActiveCount(): number {
    return this.items.filter((i) => i.status === "in-progress" || i.status === "queued").length;
  }

  onChange(listener: (items: readonly DownloadItem[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l(this.items);
  }

  /**
   * Registers a new download in the queue.
   */
  createDownload(filename: string, format = "mp4", fileSizeBytes?: number | undefined): DownloadItem {
    const id = `dl-${Math.random().toString(36).slice(2, 9)}`;
    const now = (this.deps.now ?? Date.now)();

    const item: DownloadItem = {
      id,
      filename,
      format,
      ...(fileSizeBytes !== undefined ? { fileSizeBytes } : {}),
      status: "queued",
      progress: 0,
      startedAt: now,
    };

    this.items.unshift(item);
    this.notify();
    return item;
  }

  /**
   * Updates download progress (fraction: 0..1).
   */
  updateProgress(id: string, fraction: number, bytesWritten?: number): void {
    const item = this.items.find((i) => i.id === id);
    if (!item || item.status === "completed" || item.status === "canceled") return;

    item.status = "in-progress";
    item.progress = Math.max(0, Math.min(1, fraction));
    if (bytesWritten !== undefined) {
      item.fileSizeBytes = bytesWritten;
    }
    this.notify();
  }

  /**
   * Marks download as completed and optionally triggers file saving.
   */
  completeDownload(id: string, blob: Blob, autoSave = true): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;

    const makeUrl = this.deps.createObjectUrl ?? (typeof URL !== "undefined" ? URL.createObjectURL : () => "blob:mock");
    const blobUrl = makeUrl(blob);

    item.status = "completed";
    item.progress = 1;
    item.blobUrl = blobUrl;
    item.fileSizeBytes = blob.size;
    item.completedAt = (this.deps.now ?? Date.now)();

    if (autoSave) {
      const trigger = this.deps.triggerDownload ?? defaultTriggerDownload;
      trigger(blob, item.filename);
    }

    this.notify();
  }

  /**
   * Marks a download as failed with an error message.
   */
  failDownload(id: string, errorMessage: string): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;

    item.status = "failed";
    item.error = errorMessage;
    item.completedAt = (this.deps.now ?? Date.now)();
    this.notify();
  }

  /**
   * Cancels an in-progress or queued download.
   */
  cancelDownload(id: string): void {
    const item = this.items.find((i) => i.id === id);
    if (!item || item.status === "completed") return;

    item.status = "canceled";
    item.completedAt = (this.deps.now ?? Date.now)();
    this.notify();
  }

  /**
   * Removes finished (completed/failed/canceled) items from history.
   */
  clearFinished(): void {
    const revoke = this.deps.revokeObjectUrl ?? (typeof URL !== "undefined" ? URL.revokeObjectURL : () => {});
    for (const item of this.items) {
      if (item.blobUrl && (item.status === "completed" || item.status === "canceled")) {
        revoke(item.blobUrl);
      }
    }
    this.items = this.items.filter((i) => i.status === "queued" || i.status === "in-progress");
    this.notify();
  }

  /**
   * Removes an individual item by ID.
   */
  removeItem(id: string): boolean {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return false;

    const removed = this.items[idx];
    if (!removed) return false;

    this.items.splice(idx, 1);
    if (removed.blobUrl) {
      const revoke = this.deps.revokeObjectUrl ?? (typeof URL !== "undefined" ? URL.revokeObjectURL : () => {});
      revoke(removed.blobUrl);
    }
    this.notify();
    return true;
  }
}
