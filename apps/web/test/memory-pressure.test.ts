import { describe, expect, it, vi } from "vitest";
import { MemoryPressureMonitor } from "../src/memory-pressure.js";

describe("Memory Pressure Monitor & Cache Eviction", () => {
  it("defaults to nominal level", () => {
    const monitor = new MemoryPressureMonitor();
    expect(monitor.getLevel()).toBe("nominal");
  });

  it("evaluates pressure levels based on memory usage ratios", () => {
    let used = 500;
    const limit = 1000;
    const monitor = new MemoryPressureMonitor({
      getMemoryStats: () => ({ usedJSHeapSize: used, jsHeapSizeLimit: limit }),
    });

    // 50% -> nominal
    expect(monitor.evaluate()).toBe("nominal");

    // 75% -> moderate
    used = 750;
    expect(monitor.evaluate()).toBe("moderate");

    // 90% -> critical
    used = 900;
    expect(monitor.evaluate()).toBe("critical");

    // Dropping back down to 40% -> nominal
    used = 400;
    expect(monitor.evaluate()).toBe("nominal");
  });

  it("triggers eviction callbacks at matching priority levels", () => {
    const monitor = new MemoryPressureMonitor();

    const moderateEvicted = vi.fn();
    const criticalEvicted = vi.fn();

    monitor.registerEvictor("thumbnails", "moderate", moderateEvicted);
    monitor.registerEvictor("raster-buffers", "critical", criticalEvicted);

    // Switch to moderate: thumbnails evicted, raster-buffers spared
    monitor.setPressureLevel("moderate");
    expect(moderateEvicted).toHaveBeenCalledTimes(1);
    expect(criticalEvicted).not.toHaveBeenCalled();

    // Switch to critical: both evicted
    monitor.setPressureLevel("critical");
    expect(moderateEvicted).toHaveBeenCalledTimes(2);
    expect(criticalEvicted).toHaveBeenCalledTimes(1);
  });

  it("allows unregistering evictors", () => {
    const monitor = new MemoryPressureMonitor();
    const evictor = vi.fn();
    const unregister = monitor.registerEvictor("cache", "moderate", evictor);

    unregister();
    monitor.setPressureLevel("moderate");
    expect(evictor).not.toHaveBeenCalled();
  });
});
