import { describe, expect, it } from "vitest";

import { evaluateManualSync } from "./check-user-manual-sync.mjs";

describe("evaluateManualSync", () => {
  it("ignores changes outside the user-facing feature surface", () => {
    expect(evaluateManualSync(["crates/project-store/src/lib.rs"])).toEqual({
      required: false,
      missing: [],
    });
  });

  it("requires the editable and Word manuals for a feature change", () => {
    expect(
      evaluateManualSync(["packages/playback-controller/src/animation.ts"]),
    ).toEqual({
      required: true,
      missing: [
        "docs/USER_MANUAL.md",
        "docs/Project_Director_User_Manual.docx",
      ],
    });
  });

  it("accepts a feature change accompanied by both manual formats", () => {
    expect(
      evaluateManualSync([
        "packages/export-engine/src/preset.ts",
        "docs/USER_MANUAL.md",
        "docs/Project_Director_User_Manual.docx",
      ]),
    ).toEqual({ required: true, missing: [] });
  });

  it("also requires a fresh screenshot when the visible mode UI changes", () => {
    expect(
      evaluateManualSync([
        "apps/web/src/main.ts",
        "docs/USER_MANUAL.md",
        "docs/Project_Director_User_Manual.docx",
      ]),
    ).toEqual({
      required: true,
      missing: ["docs/assets/user-manual/*.png"],
    });
  });

  it("accepts a mode UI change with source, Word document, and screenshot", () => {
    expect(
      evaluateManualSync([
        "apps\\web\\index.html",
        "docs/USER_MANUAL.md",
        "docs/Project_Director_User_Manual.docx",
        "docs/assets/user-manual/gif-mode.png",
      ]),
    ).toEqual({ required: true, missing: [] });
  });
});
