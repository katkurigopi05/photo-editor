/**
 * Memory Pressure Monitor and Resource Cache Throttle.
 *
 * Inspired by Canva's native memory monitor (`memory_pressure.node`):
 * provides proactive monitoring of memory usage and pressure levels, coordinating
 * cache eviction (proxies, thumbnails, mask rasters) to prevent Out-Of-Memory (OOM)
 * crashes during intensive editing sessions.
 */

export type MemoryPressureLevel = "nominal" | "moderate" | "critical";

export interface MemoryStats {
  usedBytes?: number | undefined;
  totalBytes?: number | undefined;
  limitBytes?: number | undefined;
  deviceMemoryGb?: number | undefined;
  pressureLevel: MemoryPressureLevel;
}

export type EvictionPriority = "idle" | "moderate" | "critical";

export interface EvictionCallback {
  (level: MemoryPressureLevel): void;
}

export interface MemoryPressureDependencies {
  getMemoryStats?: (() => { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number }) | undefined;
  deviceMemoryGb?: number | undefined;
  now?: (() => number) | undefined;
}

export class MemoryPressureMonitor {
  private level: MemoryPressureLevel = "nominal";
  private cleanups = new Map<string, { priority: EvictionPriority; fn: EvictionCallback }>();
  private listeners = new Set<(level: MemoryPressureLevel, stats: MemoryStats) => void>();

  constructor(private deps: MemoryPressureDependencies = {}) {}

  getLevel(): MemoryPressureLevel {
    return this.level;
  }

  getStats(): MemoryStats {
    let usedBytes: number | undefined;
    let totalBytes: number | undefined;
    let limitBytes: number | undefined;

    if (this.deps.getMemoryStats) {
      const s = this.deps.getMemoryStats();
      usedBytes = s.usedJSHeapSize;
      totalBytes = s.totalJSHeapSize;
      limitBytes = s.jsHeapSizeLimit;
    } else if (typeof performance !== "undefined" && "memory" in performance) {
      const m = (performance as unknown as { memory: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      usedBytes = m.usedJSHeapSize;
      totalBytes = m.totalJSHeapSize;
      limitBytes = m.jsHeapSizeLimit;
    }

    const deviceMemoryGb =
      this.deps.deviceMemoryGb ??
      (typeof navigator !== "undefined" && "deviceMemory" in navigator
        ? (navigator as unknown as { deviceMemory: number }).deviceMemory
        : undefined);

    return {
      usedBytes,
      totalBytes,
      limitBytes,
      deviceMemoryGb,
      pressureLevel: this.level,
    };
  }

  /**
   * Registers a cache cleanup handler with priority.
   * - "moderate": evicted when memory usage crosses threshold or moderate warning.
   * - "critical": evicted only during emergency critical memory pressure.
   */
  registerEvictor(name: string, priority: EvictionPriority, fn: EvictionCallback): () => void {
    this.cleanups.set(name, { priority, fn });
    return () => this.cleanups.delete(name);
  }

  onPressureChange(listener: (level: MemoryPressureLevel, stats: MemoryStats) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Evaluates memory stats and updates pressure level based on heap usage ratio.
   * - > 85% limit -> critical
   * - > 70% limit -> moderate
   * - <= 70% limit -> nominal
   */
  evaluate(): MemoryPressureLevel {
    const stats = this.getStats();
    let computedLevel: MemoryPressureLevel = "nominal";

    if (stats.usedBytes !== undefined && stats.limitBytes !== undefined && stats.limitBytes > 0) {
      const ratio = stats.usedBytes / stats.limitBytes;
      if (ratio >= 0.85) {
        computedLevel = "critical";
      } else if (ratio >= 0.7) {
        computedLevel = "moderate";
      } else {
        computedLevel = "nominal";
      }
    }

    this.setPressureLevel(computedLevel);
    return computedLevel;
  }

  /**
   * Sets pressure level explicitly (e.g. from native OS signal or test).
   */
  setPressureLevel(newLevel: MemoryPressureLevel): void {
    if (this.level === newLevel) return;

    this.level = newLevel;
    const stats = this.getStats();

    // Trigger registered evictions
    if (newLevel === "moderate") {
      for (const { priority, fn } of this.cleanups.values()) {
        if (priority === "idle" || priority === "moderate") {
          fn(newLevel);
        }
      }
    } else if (newLevel === "critical") {
      for (const { fn } of this.cleanups.values()) {
        fn(newLevel);
      }
    }

    for (const l of this.listeners) l(newLevel, stats);
  }
}
