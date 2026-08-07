import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, test } from "vitest";

import { parseArgs } from "../src/index.js";
import { ProjectSession } from "../src/session.js";

let directory: string;
let session: ProjectSession;

function command(
  session: ProjectSession,
  commandType: string,
  payload: unknown,
): Record<string, unknown> {
  const context = session.context();
  return {
    id: context.id,
    commandType,
    baseVersion: context.baseVersion,
    actor: context.actor,
    createdAt: context.createdAt,
    payload,
  };
}

const PROJECT_PAYLOAD = {
  projectId: "project-1",
  ownerId: "owner-1",
  name: "Session test",
  settings: { defaultFrameRate: { numerator: 30, denominator: 1 } },
};

beforeEach(async () => {
  directory = await realpath(
    await mkdtemp(join(tmpdir(), "director-mcp-session-")),
  );
  session = new ProjectSession({ actorId: "mcp:test", root: directory });
  await session.open(join(directory, "project.director.json"));
});

describe("ProjectSession", () => {
  test("applies a valid command and bumps the version", async () => {
    const outcome = await session.dispatch(
      command(session, "project.create", PROJECT_PAYLOAD),
    );
    expect(outcome.ok).toBe(true);
    expect(session.getProject()?.name).toBe("Session test");
    expect(outcome.version).toBeGreaterThan(0);
  });

  test("attributes commands to an agent, not a user", async () => {
    // Provenance is the point: a project edited over MCP should show which
    // changes an AI tool made.
    await session.dispatch(command(session, "project.create", PROJECT_PAYLOAD));
    const operation = session.getOperations()[0];
    expect(operation?.command.actor).toEqual({ type: "agent", id: "mcp:test" });
  });

  test("rejects an invalid command without changing state", async () => {
    const before = session.getVersion();
    const outcome = await session.dispatch(
      command(session, "project.create", { name: "missing everything else" }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBeDefined();
    expect(session.getVersion()).toBe(before);
    expect(session.getProject()).toBeNull();
  });

  test("rejects an unknown command type", async () => {
    const outcome = await session.dispatch(
      command(session, "timeline.teleport_clip", {}),
    );
    expect(outcome.ok).toBe(false);
  });

  test("undo returns to the previous version and redo restores it", async () => {
    await session.dispatch(command(session, "project.create", PROJECT_PAYLOAD));
    const created = session.getVersion();

    expect(session.canUndo()).toBe(true);
    const undone = await session.undo();
    expect(undone.ok).toBe(true);
    expect(session.getProject()).toBeNull();

    const redone = await session.redo();
    expect(redone.ok).toBe(true);
    expect(session.getVersion()).toBe(created);
    expect(session.getProject()?.name).toBe("Session test");
  });

  test("undo on an empty history fails without throwing", async () => {
    const outcome = await session.undo();
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.message).toMatch(/undo/i);
  });

  test("an undone command does not survive reopening", async () => {
    // Undo shortens the operation log, and the log is what gets written — so
    // a reopened file must not contain the undone work.
    const path = session.requirePath();
    await session.dispatch(command(session, "project.create", PROJECT_PAYLOAD));
    await session.undo();

    const reopened = new ProjectSession({
      actorId: "mcp:test",
      root: directory,
    });
    await reopened.open(path);
    expect(reopened.getProject()).toBeNull();
    expect(reopened.getOperations()).toHaveLength(0);
  });

  test("requires a project before project-scoped reads", () => {
    expect(() => session.requireProject()).toThrow(/create_project/);
  });

  test("requires an open file before anything else", () => {
    const unopened = new ProjectSession();
    expect(() => unopened.requirePath()).toThrow(/open_project/);
  });
});

describe("parseArgs", () => {
  test("reads the project path and actor id", () => {
    expect(parseArgs(["--project", "/tmp/a.json", "--actor", "codex"])).toEqual(
      {
        project: "/tmp/a.json",
        actorId: "codex",
      },
    );
  });

  test("accepts the -p short form", () => {
    expect(parseArgs(["-p", "/tmp/a.json"])).toEqual({
      project: "/tmp/a.json",
    });
  });

  test("ignores flags with no value and unknown flags", () => {
    expect(parseArgs(["--project"])).toEqual({});
    expect(parseArgs(["--nonsense", "x"])).toEqual({});
  });
});
