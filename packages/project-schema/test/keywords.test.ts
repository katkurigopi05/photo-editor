import { describe, expect, it } from "vitest";
import { assetKeywordsSchema, normalizeKeyword } from "../src/keywords.js";
import { mediaAssetSchema } from "../src/entities.js";

/**
 * Keywords on an asset.
 *
 * Final Cut's keywords are how a large shoot becomes findable. The rules that
 * matter are about identity: "Interview" and "interview" are the same keyword
 * to a person, so they must be the same keyword to the filter, or the bin fills
 * with near-duplicates that each match half the footage.
 */

const asset = (keywords?: unknown) => ({
  id: "asset-1",
  projectId: "project-1",
  kind: "video" as const,
  originalUri: "file:///clip.mov",
  checksum: "0".repeat(64),
  metadata: { fileSizeBytes: "1000", durationUs: "5000000" },
  createdAt: "2026-01-01T00:00:00.000Z",
  ...(keywords === undefined ? {} : { keywords }),
});

describe("normalizeKeyword", () => {
  it("trims and folds case, so one keyword has one spelling", () => {
    expect(normalizeKeyword("  Interview ")).toBe("interview");
    expect(normalizeKeyword("INTERVIEW")).toBe("interview");
  });

  it("collapses inner whitespace", () => {
    expect(normalizeKeyword("wide  shot")).toBe("wide shot");
  });

  it("returns null for anything that is not a keyword", () => {
    for (const input of ["", "   ", "\t\n"]) {
      expect(normalizeKeyword(input)).toBeNull();
    }
  });
});

describe("assetKeywordsSchema", () => {
  it("accepts a list of normalized keywords", () => {
    expect(assetKeywordsSchema.parse(["interview", "wide shot"])).toEqual([
      "interview",
      "wide shot",
    ]);
  });

  it("rejects duplicates", () => {
    expect(assetKeywordsSchema.safeParse(["b-roll", "b-roll"]).success).toBe(
      false,
    );
  });

  it("rejects unnormalized entries", () => {
    // The schema refuses rather than normalizing: a command that silently
    // rewrote its payload would not replay to the same bytes it recorded.
    for (const bad of ["Interview", " interview", "wide  shot"]) {
      expect(assetKeywordsSchema.safeParse([bad]).success).toBe(false);
    }
  });

  it("rejects an empty or over-long keyword", () => {
    expect(assetKeywordsSchema.safeParse([""]).success).toBe(false);
    expect(assetKeywordsSchema.safeParse(["x".repeat(65)]).success).toBe(false);
  });

  it("accepts an empty list", () => {
    // The command clears keywords by setting an empty list; the reducer is what
    // turns that into an absent member.
    expect(assetKeywordsSchema.safeParse([]).success).toBe(true);
  });
});

describe("assets carrying keywords", () => {
  it("parses an asset with no keywords exactly as before", () => {
    expect(mediaAssetSchema.parse(asset())).not.toHaveProperty("keywords");
  });

  it("accepts an asset with keywords", () => {
    expect(mediaAssetSchema.parse(asset(["interview"])).keywords).toEqual([
      "interview",
    ]);
  });

  it("rejects an asset whose keywords are not normalized", () => {
    expect(mediaAssetSchema.safeParse(asset(["Interview"])).success).toBe(
      false,
    );
  });
});
