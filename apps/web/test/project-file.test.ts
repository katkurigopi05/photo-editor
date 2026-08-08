import { describe, expect, it } from "vitest";
import {
  buildProjectFile,
  parseProjectFile,
  planRelink,
  serializeProjectFile,
  PROJECT_FILE_VERSION,
  type MediaHint,
} from "../src/project-file.js";

/**
 * Saving and opening a project.
 *
 * The operation log is the project — replaying it reconstructs the state — so
 * the file is that log plus hints for finding the media again. The tests are
 * about the two things a save format has to get right: refusing a file it
 * cannot honestly read, and matching media back to assets without guessing
 * silently.
 */

const hint = (overrides: Partial<MediaHint> = {}): MediaHint => ({
  assetId: "asset-1",
  name: "shot.mov",
  checksum: "a".repeat(64),
  fileSizeBytes: "1024",
  kind: "video",
  ...overrides,
});

describe("project file round trip", () => {
  it("records how much of the log is scaffolding", () => {
    // Undo must stop at the same place in every session that opens the file.
    const file = buildProjectFile([], [], "2026-08-08T00:00:00.000Z", 4);
    const parsed = parseProjectFile(serializeProjectFile(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file.baseline).toBe(4);
  });

  it("writes and reads back an empty project", () => {
    const file = buildProjectFile([], [], "2026-08-08T00:00:00.000Z");
    const parsed = parseProjectFile(serializeProjectFile(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file.formatVersion).toBe(PROJECT_FILE_VERSION);
    expect(parsed.file.operations).toEqual([]);
  });

  it("carries media hints through", () => {
    const file = buildProjectFile([], [hint()], "2026-08-08T00:00:00.000Z");
    const parsed = parseProjectFile(serializeProjectFile(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file.media[0]?.name).toBe("shot.mov");
  });

  it("ends with a newline, so the file is diffable", () => {
    expect(
      serializeProjectFile(buildProjectFile([], [], "2026-08-08T00:00:00.000Z")),
    ).toMatch(/\}\n$/);
  });
});

describe("parseProjectFile refuses what it cannot honestly read", () => {
  it("rejects text that is not JSON", () => {
    const result = parseProjectFile("not a project");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("valid JSON");
  });

  it("rejects JSON that is not a project file", () => {
    const result = parseProjectFile(JSON.stringify({ hello: "world" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not a Project Director");
  });

  it("rejects a newer format version by name", () => {
    // Reading a future file with today's rules would silently drop whatever it
    // added. Refusing says which version wrote it.
    const result = parseProjectFile(
      JSON.stringify({
        format: "project-director.project",
        formatVersion: PROJECT_FILE_VERSION + 5,
        savedAt: "2026-08-08T00:00:00.000Z",
        baseline: 0,
        operations: [],
        media: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(String(PROJECT_FILE_VERSION + 5));
      expect(result.error).toContain("newer version");
    }
  });

  it("reports where a damaged file is damaged", () => {
    const result = parseProjectFile(
      JSON.stringify({
        format: "project-director.project",
        formatVersion: PROJECT_FILE_VERSION,
        savedAt: "2026-08-08T00:00:00.000Z",
        baseline: 0,
        operations: [],
        media: [{ assetId: "asset-1", name: "x" }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("media");
  });
});

describe("planRelink", () => {
  it("matches by checksum, whatever the file is called now", () => {
    const plan = planRelink(
      [hint()],
      [{ name: "renamed.mov", fileSizeBytes: "1024", checksum: "a".repeat(64) }],
    );
    expect(plan.unmatched).toEqual([]);
    expect(plan.matches[0]).toMatchObject({
      assetId: "asset-1",
      candidateIndex: 0,
      confidence: "checksum",
    });
  });

  it("falls back to name and size, and says it is a guess", () => {
    const plan = planRelink(
      [hint()],
      [{ name: "shot.mov", fileSizeBytes: "1024" }],
    );
    expect(plan.matches[0]?.confidence).toBe("name-and-size");
  });

  it("prefers a checksum match over an earlier hint's name guess", () => {
    // Two passes exist for this: hint A would take the file by name in a single
    // pass, leaving hint B — whose checksum proves ownership — unmatched.
    const plan = planRelink(
      [
        hint({ assetId: "asset-a", name: "clip.mov", checksum: "b".repeat(64) }),
        hint({ assetId: "asset-b", name: "other.mov", checksum: "c".repeat(64) }),
      ],
      [{ name: "clip.mov", fileSizeBytes: "1024", checksum: "c".repeat(64) }],
    );
    expect(plan.matches).toEqual([
      { assetId: "asset-b", candidateIndex: 0, confidence: "checksum" },
    ]);
    expect(plan.unmatched.map((h) => h.assetId)).toEqual(["asset-a"]);
  });

  it("never gives one file to two assets", () => {
    const plan = planRelink(
      [hint({ assetId: "asset-a" }), hint({ assetId: "asset-b" })],
      [{ name: "shot.mov", fileSizeBytes: "1024", checksum: "a".repeat(64) }],
    );
    expect(plan.matches).toHaveLength(1);
    expect(plan.unmatched).toHaveLength(1);
  });

  it("reports what it could not find", () => {
    const plan = planRelink([hint()], [
      { name: "unrelated.mp4", fileSizeBytes: "99" },
    ]);
    expect(plan.matches).toEqual([]);
    expect(plan.unmatched[0]?.name).toBe("shot.mov");
  });

  it("matches nothing when nothing is offered", () => {
    const plan = planRelink([hint()], []);
    expect(plan.unmatched).toHaveLength(1);
  });
});
