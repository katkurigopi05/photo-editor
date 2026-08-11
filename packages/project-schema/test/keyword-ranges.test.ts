import { describe, expect, it } from "vitest";
import {
  assetKeywordRangeSchema,
  assetKeywordRangesSchema,
} from "../src/keywords.js";
import { mediaAssetSchema } from "../src/entities.js";

/**
 * Keyword ranges: a keyword over a *portion* of an asset.
 *
 * The asset-level list says "this shot is an interview". A range says "seconds
 * three to nine of it are the good take". The identity rule is the same one
 * keywords already carry — one keyword, one spelling — so a range reuses the
 * keyword schema rather than inventing a second, laxer spelling rule.
 *
 * Bounds are source-local microseconds, half-open like every other range in the
 * model. Whether a range *fits* the asset is the reducer's business: only it
 * knows the asset's duration.
 */

const range = (overrides: Record<string, unknown> = {}) => ({
  id: "range-1",
  keyword: "interview",
  startUs: "3000000",
  endUs: "9000000",
  ...overrides,
});

const asset = (keywordRanges?: unknown) => ({
  id: "asset-1",
  projectId: "project-1",
  kind: "video" as const,
  originalUri: "file:///clip.mov",
  checksum: "0".repeat(64),
  metadata: { fileSizeBytes: "1000", durationUs: "5000000" },
  createdAt: "2026-01-01T00:00:00.000Z",
  ...(keywordRanges === undefined ? {} : { keywordRanges }),
});

describe("assetKeywordRangeSchema", () => {
  it("accepts a range over part of a shot", () => {
    expect(assetKeywordRangeSchema.parse(range())).toEqual({
      id: "range-1",
      keyword: "interview",
      startUs: "3000000",
      endUs: "9000000",
    });
  });

  it("rejects an unnormalized keyword, exactly as the asset list does", () => {
    // Reusing the keyword schema is the point: a range spelled "Interview"
    // would filter as a different keyword from the list's "interview".
    for (const bad of ["Interview", " interview", "wide  shot"]) {
      expect(
        assetKeywordRangeSchema.safeParse(range({ keyword: bad })).success,
      ).toBe(false);
    }
  });

  it("rejects an empty range", () => {
    // Half-open: start === end covers no picture at all, which is not a
    // selection. Sharing the browser range's "at least something" rule.
    expect(
      assetKeywordRangeSchema.safeParse(
        range({ startUs: "3000000", endUs: "3000000" }),
      ).success,
    ).toBe(false);
  });

  it("rejects a backwards range", () => {
    expect(
      assetKeywordRangeSchema.safeParse(
        range({ startUs: "9000000", endUs: "3000000" }),
      ).success,
    ).toBe(false);
  });

  it("rejects non-canonical microseconds", () => {
    for (const bad of ["03000000", "3.5", "-1", ""]) {
      expect(
        assetKeywordRangeSchema.safeParse(range({ startUs: bad })).success,
      ).toBe(false);
    }
  });

  it("rejects unknown members", () => {
    expect(
      assetKeywordRangeSchema.safeParse(range({ colour: "red" })).success,
    ).toBe(false);
  });
});

describe("assetKeywordRangesSchema", () => {
  it("accepts several ranges on one asset", () => {
    const ranges = [
      range(),
      range({ id: "range-2", keyword: "wide shot", startUs: "0" }),
    ];
    expect(assetKeywordRangesSchema.parse(ranges)).toHaveLength(2);
  });

  it("rejects duplicate ids, so a command can name exactly one", () => {
    expect(
      assetKeywordRangesSchema.safeParse([
        range(),
        range({ keyword: "b-roll" }),
      ]).success,
    ).toBe(false);
  });

  it("accepts two keywords over the same span", () => {
    // A stretch that is both an interview and a wide shot is ordinary, and the
    // same reasoning markers use for two notes on one instant.
    expect(
      assetKeywordRangesSchema.safeParse([
        range(),
        range({ id: "range-2", keyword: "wide shot" }),
      ]).success,
    ).toBe(true);
  });

  it("accepts overlapping ranges of the same keyword", () => {
    // Merging them would rewrite the payload the command recorded, which is
    // the property the whole engine rests on. The UI may offer to merge; the
    // schema does not do it behind the caller's back.
    expect(
      assetKeywordRangesSchema.safeParse([
        range(),
        range({ id: "range-2", startUs: "5000000", endUs: "12000000" }),
      ]).success,
    ).toBe(true);
  });

  it("accepts an empty list", () => {
    // The reducer is what turns an empty list into an absent member.
    expect(assetKeywordRangesSchema.safeParse([]).success).toBe(true);
  });
});

describe("assets carrying keyword ranges", () => {
  it("parses an asset with no ranges exactly as before", () => {
    expect(mediaAssetSchema.parse(asset())).not.toHaveProperty("keywordRanges");
  });

  it("accepts an asset with ranges", () => {
    expect(mediaAssetSchema.parse(asset([range()])).keywordRanges).toEqual([
      range(),
    ]);
  });

  it("rejects an asset whose ranges are not normalized", () => {
    expect(
      mediaAssetSchema.safeParse(asset([range({ keyword: "Interview" })]))
        .success,
    ).toBe(false);
  });
});
