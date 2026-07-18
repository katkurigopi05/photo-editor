import { describe, expect, it } from "vitest";
import { canonicalStringify } from "@director/canonical-json";
import {
  InMemoryPersistence,
  replay,
  createEditorState,
  executeCommand,
} from "../src/index.js";
import { createProjectCommand, mustExecute } from "./fixtures.js";

describe("InMemoryPersistence", () => {
  it("defensively copies on save and load (no shared references)", async () => {
    const store = new InMemoryPersistence();
    const exec = mustExecute(createEditorState(), createProjectCommand());
    const operations = exec.state.operationLog;

    await store.saveOperationLog(operations);
    const loaded = await store.loadOperationLog();

    expect(canonicalStringify(loaded)).toBe(canonicalStringify(operations));
    // Mutating the loaded value must not affect a subsequent load.
    loaded[0]!.baseVersion = 999;
    const reloaded = await store.loadOperationLog();
    expect(reloaded[0]!.baseVersion).toBe(0);
  });

  it("does not retain a reference to the caller's array after save", async () => {
    const store = new InMemoryPersistence();
    const exec = mustExecute(createEditorState(), createProjectCommand());
    const operations = [...exec.state.operationLog];

    await store.saveOperationLog(operations);
    // Mutate caller's array after saving.
    operations.length = 0;

    const loaded = await store.loadOperationLog();
    expect(loaded).toHaveLength(1);
  });

  it("round-trips the operation log back into an equivalent replayed state", async () => {
    const store = new InMemoryPersistence();
    const exec = mustExecute(createEditorState(), createProjectCommand());
    await store.saveOperationLog(exec.state.operationLog);

    const loaded = await store.loadOperationLog();
    const result = replay(loaded);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(canonicalStringify(result.state.project)).toBe(
        canonicalStringify(exec.state.project),
      );
    }
  });

  it("saves and loads full editor state defensively", async () => {
    const store = new InMemoryPersistence();
    const exec = mustExecute(createEditorState(), createProjectCommand());
    await store.saveEditorState(exec.state);
    const loaded = await store.loadEditorState();
    expect(loaded).not.toBeNull();
    expect(canonicalStringify(loaded)).toBe(canonicalStringify(exec.state));
  });

  it("JSON serialization round-trips an operation and re-parses", () => {
    const exec = mustExecute(createEditorState(), createProjectCommand());
    const json = JSON.stringify(exec.operation);
    const parsed = JSON.parse(json);
    // Re-execute a replay from the parsed operation to prove structural validity.
    const result = replay([parsed]);
    expect(result.ok).toBe(true);
  });

  it("executeCommand never throws for expected domain failures", () => {
    const result = executeCommand(createEditorState(), {
      commandType: "timeline.add_clip",
    });
    expect(result.ok).toBe(false);
  });
});
