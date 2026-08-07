import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, test } from "vitest";

import {
  PROJECT_SUFFIX,
  PathNotAllowedError,
  resolveProjectPath,
} from "../src/paths.js";
import { anchorToProjectDir } from "../src/index.js";

let root: string;
let outside: string;

beforeEach(() => {
  // realpath because macOS puts temp dirs behind a /var -> /private/var link,
  // which would otherwise make every containment check look like an escape.
  root = realpathSync(mkdtempSync(join(tmpdir(), "paths-root-")));
  outside = realpathSync(mkdtempSync(join(tmpdir(), "paths-outside-")));
});

describe("resolveProjectPath", () => {
  test("accepts a project file inside the root", () => {
    const resolved = resolveProjectPath(`edit${PROJECT_SUFFIX}`, root);
    expect(resolved).toBe(join(root, `edit${PROJECT_SUFFIX}`));
  });

  test("accepts a not-yet-created file in a not-yet-created subdirectory", () => {
    // Starting a new project must not require the folder to exist first.
    const resolved = resolveProjectPath(`a/b/new${PROJECT_SUFFIX}`, root);
    expect(resolved).toBe(join(root, "a", "b", `new${PROJECT_SUFFIX}`));
  });

  test("rejects an absolute path outside the root", () => {
    expect(() =>
      resolveProjectPath(join(outside, `x${PROJECT_SUFFIX}`), root),
    ).toThrow(/outside the project root/);
  });

  test("rejects traversal out of the root", () => {
    expect(() =>
      resolveProjectPath(`../escape${PROJECT_SUFFIX}`, root),
    ).toThrow(PathNotAllowedError);
  });

  test("rejects a file that does not carry the project suffix", () => {
    // Without this, a valid-looking log could be written over any .json in
    // the root — a package.json, a lockfile, a config.
    expect(() => resolveProjectPath("package.json", root)).toThrow(
      /must end in/,
    );
  });

  test("rejects an empty path", () => {
    expect(() => resolveProjectPath("   ", root)).toThrow(PathNotAllowedError);
  });

  test("refuses to write through a symlinked file", () => {
    const target = join(outside, "target.json");
    writeFileSync(target, "{}", "utf8");
    const link = join(root, `linked${PROJECT_SUFFIX}`);
    symlinkSync(target, link);
    expect(() => resolveProjectPath(link, root)).toThrow(/symbolic link/);
  });

  test("rejects a path whose parent directory links outside the root", () => {
    // The containment test has to run on where the path really lands, not on
    // the literal string, or a symlinked parent smuggles it out.
    symlinkSync(outside, join(root, "escape-hatch"));
    expect(() =>
      resolveProjectPath(`escape-hatch/x${PROJECT_SUFFIX}`, root),
    ).toThrow(/outside the project root/);
  });

  test("rejects a directory in place of a file", () => {
    mkdirSync(join(root, `dir${PROJECT_SUFFIX}`));
    expect(() => resolveProjectPath(`dir${PROJECT_SUFFIX}`, root)).toThrow(
      /not a regular file/,
    );
  });

  test("rejects a root that does not exist", () => {
    expect(() =>
      resolveProjectPath(`x${PROJECT_SUFFIX}`, join(outside, "absent")),
    ).toThrow(/does not exist/);
  });
});

describe("anchorToProjectDir", () => {
  // Claude Code sets CLAUDE_PROJECT_DIR in the server's environment rather
  // than its own, so `${CLAUDE_PROJECT_DIR:-.}` in a client config's args
  // always expands to ".". A project-scoped .mcp.json therefore passes a
  // relative path and relies on this to place it.
  test("resolves a relative path against the project dir", () => {
    expect(anchorToProjectDir("director-projects", "/repo")).toBe(
      "/repo/director-projects",
    );
  });

  test("normalizes the './' form a config default produces", () => {
    expect(anchorToProjectDir("./director-projects", "/repo")).toBe(
      "/repo/director-projects",
    );
  });

  test("leaves an absolute path alone", () => {
    expect(anchorToProjectDir("/elsewhere/projects", "/repo")).toBe(
      "/elsewhere/projects",
    );
  });

  test("falls back to the caller's own resolution when unset or empty", () => {
    // A bare shell invocation has no CLAUDE_PROJECT_DIR; the path is then
    // relative to the working directory, as it was before.
    expect(anchorToProjectDir("projects", undefined)).toBe("projects");
    expect(anchorToProjectDir("projects", "")).toBe("projects");
  });
});
