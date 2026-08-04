import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, test } from "vitest";

import { ProjectFileError, loadProjectFile } from "../src/project-store.js";
import { ProjectSession } from "../src/session.js";

/** A session with fixed ids and timestamps, so files are byte-comparable. */
function fixedSession(): ProjectSession {
  let counter = 0;
  return new ProjectSession({
    actorId: "mcp:test",
    root: directory,
    newId: () =>
      `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    now: () => "2026-08-02T00:00:00.000Z",
  });
}

async function seedProject(session: ProjectSession): Promise<void> {
  const context = session.context();
  await session.dispatch({
    id: context.id,
    commandType: "project.create",
    baseVersion: 0,
    actor: context.actor,
    createdAt: context.createdAt,
    payload: {
      projectId: "project-1",
      ownerId: "owner-1",
      name: "Test project",
      settings: { defaultFrameRate: { numerator: 30, denominator: 1 } },
    },
  });
}

let directory: string;

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "director-mcp-")));
});

describe("loadProjectFile", () => {
  test("treats a missing file as a new, empty project", async () => {
    // Opening a path that does not exist yet is how a project starts, so it
    // must not read as an error.
    const loaded = await loadProjectFile(
      join(directory, "absent.director.json"),
    );
    expect(loaded.existed).toBe(false);
    expect(loaded.operationCount).toBe(0);
    expect(loaded.state.project).toBeNull();
  });

  test("rejects a file that is not JSON", async () => {
    const path = join(directory, "broken.director.json");
    await writeFile(path, "{ not json", "utf8");
    await expect(loadProjectFile(path)).rejects.toThrow(ProjectFileError);
  });

  test("rejects JSON that is not a project file", async () => {
    const path = join(directory, "other.director.json");
    await writeFile(path, JSON.stringify({ hello: "world" }), "utf8");
    await expect(loadProjectFile(path)).rejects.toThrow(/operations/);
  });

  test("reports which operation failed when the log cannot replay", async () => {
    const path = join(directory, "corrupt.director.json");
    await writeFile(
      path,
      JSON.stringify({ fileVersion: 1, operations: [{ nonsense: true }] }),
      "utf8",
    );
    // The index matters: it is the difference between "your file is broken"
    // and "operation 0 is broken", which is what makes it fixable.
    await expect(loadProjectFile(path)).rejects.toThrow(/operation index 0/);
  });
});

describe("saveProjectFile", () => {
  test("round-trips a project through the operation log", async () => {
    const path = join(directory, "round-trip.director.json");
    const session = fixedSession();
    await session.open(path);
    await seedProject(session);

    const reopened = fixedSession();
    await reopened.open(path);
    expect(reopened.getProject()?.name).toBe("Test project");
    expect(reopened.getVersion()).toBe(session.getVersion());
    expect(reopened.getOperations()).toHaveLength(1);
  });

  test("writes canonical JSON, so identical edits produce identical bytes", async () => {
    const first = join(directory, "a.director.json");
    const second = join(directory, "b.director.json");
    for (const path of [first, second]) {
      const session = fixedSession();
      await session.open(path);
      await seedProject(session);
    }
    expect(await readFile(first, "utf8")).toBe(await readFile(second, "utf8"));
  });

  test("leaves no temporary file behind", async () => {
    const path = join(directory, "clean.director.json");
    const session = fixedSession();
    await session.open(path);
    await seedProject(session);
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(directory);
    expect(entries.filter((name) => name.includes(".tmp-"))).toHaveLength(0);
  });

  test("stores the operation log rather than a project snapshot", async () => {
    // The log is the source of truth in this codebase; a snapshot would drift
    // from it and could not be replayed or undone.
    const path = join(directory, "log.director.json");
    const session = fixedSession();
    await session.open(path);
    await seedProject(session);
    const written = JSON.parse(await readFile(path, "utf8")) as {
      operations: { command: { commandType: string } }[];
    };
    expect(written.operations[0]?.command.commandType).toBe("project.create");
  });
});
