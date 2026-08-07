import { describe, expect, test } from "vitest";

import {
  detectKind,
  fileExtension,
  isMediaFile,
} from "../src/media-types.js";

describe("fileExtension", () => {
  test("lower-cases and takes only the last segment", () => {
    expect(fileExtension("Clip.FINAL.MP4")).toBe("mp4");
  });

  test("returns empty for names without a usable extension", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension("trailing.")).toBe("");
    // A dotfile is a hidden file, not a "gitignore-typed" one.
    expect(fileExtension(".gitignore")).toBe("");
  });
});

describe("detectKind", () => {
  test("trusts the MIME type when the browser supplies one", () => {
    expect(detectKind({ name: "a.bin", type: "video/mp4" })).toBe("video");
    expect(detectKind({ name: "a.bin", type: "audio/mpeg" })).toBe("audio");
    expect(detectKind({ name: "a.bin", type: "image/png" })).toBe("image");
  });

  test("falls back to the extension when the type is missing", () => {
    // Files dragged from some apps arrive with no type at all.
    expect(detectKind({ name: "clip.mov", type: "" })).toBe("video");
    expect(detectKind({ name: "song.flac", type: "" })).toBe("audio");
    expect(detectKind({ name: "shot.webp", type: "" })).toBe("image");
  });

  test("falls back when the type is a generic binary blob", () => {
    expect(
      detectKind({ name: "clip.webm", type: "application/octet-stream" }),
    ).toBe("video");
  });

  test("is case-insensitive about extensions", () => {
    expect(detectKind({ name: "CLIP.MOV", type: "" })).toBe("video");
  });

  test("treats an unrecognised file as an image, to be caught at decode", () => {
    expect(detectKind({ name: "notes.txt", type: "" })).toBe("image");
  });
});

describe("isMediaFile", () => {
  test("accepts by MIME type", () => {
    expect(isMediaFile({ name: "whatever", type: "image/jpeg" })).toBe(true);
  });

  test("accepts by extension when the type is absent", () => {
    expect(isMediaFile({ name: "take-1.mp3", type: "" })).toBe(true);
  });

  test("rejects non-media files", () => {
    expect(isMediaFile({ name: "notes.txt", type: "text/plain" })).toBe(false);
    expect(isMediaFile({ name: "archive.zip", type: "" })).toBe(false);
  });
});
