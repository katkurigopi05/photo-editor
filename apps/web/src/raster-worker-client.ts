import type { RasterImage } from "@director/raster-tools";
import {
  type RasterWorkerOperation,
  type RasterWorkerRequest,
  type RasterWorkerResponse,
  executeRasterOperation,
} from "./raster-worker.js";

/**
 * Client coordinator managing raster worker lifecycle, asynchronous request
 * queuing, zero-copy buffer transfers, and request cancellation.
 */

export interface RasterJobOptions {
  params?: Record<string, number | boolean | string | undefined>;
  signal?: AbortSignal;
  /** Optional channel key to cancel any previous in-flight job on the same channel (e.g. "clarity-slider"). */
  channel?: string;
}

export class RasterWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<
    string,
    {
      resolve: (image: RasterImage) => void;
      reject: (error: Error) => void;
      channel?: string | undefined;
    }
  >();
  private activeChannelRequests = new Map<string, string>();
  private nextId = 1;

  constructor() {
    this.ensureWorker();
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (typeof Worker === "undefined") return null;

    try {
      this.worker = new Worker(
        new URL("./raster-worker.js", import.meta.url),
        { type: "module" },
      );

      this.worker.onmessage = (event: MessageEvent<RasterWorkerResponse>) => {
        const res = event.data;
        const entry = this.pending.get(res.id);
        if (!entry) return;

        this.pending.delete(res.id);
        if (entry.channel && this.activeChannelRequests.get(entry.channel) === res.id) {
          this.activeChannelRequests.delete(entry.channel);
        }

        if (res.type === "done") {
          const result: RasterImage = {
            width: res.width,
            height: res.height,
            data: new Uint8ClampedArray(res.data),
          };
          entry.resolve(result);
        } else {
          entry.reject(new Error(res.message));
        }
      };

      this.worker.onerror = (error) => {
        const message = error.message || "Unknown raster worker error";
        for (const [_id, entry] of this.pending) {
          entry.reject(new Error(message));
        }
        this.pending.clear();
        this.activeChannelRequests.clear();
        this.terminate();
      };

      return this.worker;
    } catch {
      this.worker = null;
      return null;
    }
  }

  /**
   * Run a raster operation asynchronously in the worker if available,
   * or synchronously on the main thread as fallback.
   */
  async run(
    operation: RasterWorkerOperation,
    image: RasterImage,
    options: RasterJobOptions = {},
  ): Promise<RasterImage> {
    const { params = {}, signal, channel } = options;

    if (signal?.aborted) {
      throw new Error("Raster operation was aborted");
    }

    const worker = this.ensureWorker();
    // Fallback to synchronous execution if Worker is unavailable
    if (!worker) {
      return executeRasterOperation(operation, image, params);
    }

    const id = `raster-${this.nextId++}-${Date.now()}`;

    // If channel is specified, cancel previous request tracking on this channel
    if (channel) {
      const prevId = this.activeChannelRequests.get(channel);
      if (prevId) {
        const prev = this.pending.get(prevId);
        if (prev) {
          prev.reject(new Error(`Operation preempted by newer request on channel '${channel}'`));
          this.pending.delete(prevId);
        }
      }
      this.activeChannelRequests.set(channel, id);
    }

    return new Promise<RasterImage>((resolve, reject) => {
      if (signal) {
        signal.addEventListener("abort", () => {
          this.pending.delete(id);
          if (channel && this.activeChannelRequests.get(channel) === id) {
            this.activeChannelRequests.delete(channel);
          }
          reject(new Error("Raster operation was aborted"));
        });
      }

      this.pending.set(id, { resolve, reject, channel });

      // Clone array buffer for zero-copy transferable postMessage
      const buffer = image.data.buffer.slice(
        image.data.byteOffset,
        image.data.byteOffset + image.data.byteLength,
      ) as ArrayBuffer;

      const request: RasterWorkerRequest = {
        id,
        operation,
        width: image.width,
        height: image.height,
        data: buffer,
        params,
      };

      worker.postMessage(request, [buffer]);
    });
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

// Global default singleton
export const rasterWorkerClient = new RasterWorkerClient();
