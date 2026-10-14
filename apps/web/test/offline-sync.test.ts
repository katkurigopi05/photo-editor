import { describe, expect, it } from "vitest";
import {
  MemoryOfflineStorage,
  OfflineSyncEngine,
} from "../src/offline-sync.js";

describe("Offline Project Cache & Sync Engine", () => {
  it("caches and retrieves project snapshots", async () => {
    const engine = new OfflineSyncEngine();
    await engine.cacheProject("proj-1", 4, JSON.stringify({ tracks: [] }));

    const cached = await engine.getCachedProject("proj-1");
    expect(cached).not.toBeNull();
    expect(cached?.projectId).toBe("proj-1");
    expect(cached?.version).toBe(4);
  });

  it("queues commands when offline and monitors status changes", async () => {
    const engine = new OfflineSyncEngine();
    const statusLog: string[] = [];
    const unsubscribe = engine.onStatusChange((s) => statusLog.push(s));

    engine.setStatus("offline");
    expect(engine.currentStatus).toBe("offline");

    await engine.enqueueOfflineCommand({
      commandId: "cmd-1",
      projectId: "proj-1",
      expectedVersion: 1,
      commandType: "add_clip",
      payload: { id: "clip-1" },
    });

    await engine.enqueueOfflineCommand({
      commandId: "cmd-2",
      projectId: "proj-1",
      expectedVersion: 2,
      commandType: "add_clip",
      payload: { id: "clip-2" },
    });

    const pending = await engine.getPendingCount("proj-1");
    expect(pending).toBe(2);

    expect(statusLog).toEqual(["offline"]);
    unsubscribe();
  });

  it("refuses to sync while offline", async () => {
    const engine = new OfflineSyncEngine(new MemoryOfflineStorage(), "offline");
    const result = await engine.flushSyncQueue(async () => true);
    expect(result.syncedCount).toBe(0);
    expect(result.errors[0]).toContain("Cannot sync while offline");
  });

  it("flushes queued commands in sequence upon reconnection", async () => {
    const engine = new OfflineSyncEngine();
    await engine.enqueueOfflineCommand({
      commandId: "c1",
      projectId: "p1",
      expectedVersion: 1,
      commandType: "split_clip",
      payload: {},
    });
    await engine.enqueueOfflineCommand({
      commandId: "c2",
      projectId: "p1",
      expectedVersion: 2,
      commandType: "delete_clip",
      payload: {},
    });

    const executed: string[] = [];
    const result = await engine.flushSyncQueue(async (cmd) => {
      executed.push(cmd.commandId);
      return true;
    });

    expect(result.syncedCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(executed).toEqual(["c1", "c2"]);

    const remaining = await engine.getPendingCount();
    expect(remaining).toBe(0);
  });

  it("halts replay on failure to preserve deterministic ordering", async () => {
    const engine = new OfflineSyncEngine();
    await engine.enqueueOfflineCommand({
      commandId: "ok-1",
      projectId: "p1",
      expectedVersion: 1,
      commandType: "t1",
      payload: {},
    });
    await engine.enqueueOfflineCommand({
      commandId: "fail-2",
      projectId: "p1",
      expectedVersion: 2,
      commandType: "t2",
      payload: {},
    });
    await engine.enqueueOfflineCommand({
      commandId: "skip-3",
      projectId: "p1",
      expectedVersion: 3,
      commandType: "t3",
      payload: {},
    });

    const result = await engine.flushSyncQueue(async (cmd) => {
      if (cmd.commandId === "fail-2") return false;
      return true;
    });

    expect(result.syncedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(engine.currentStatus).toBe("error");

    const remaining = await engine.getPendingCount();
    expect(remaining).toBe(2); // fail-2 and skip-3 remain in queue
  });
});
