import { describe, expect, it } from "vitest";
import {
  assetKindSchema,
  isAssetCompatibleWithTrack,
  mediaAssetSchema,
} from "../src/entities.js";

/**
 * Adjustment layers.
 *
 * A clip that carries no picture of its own and applies its effects to
 * everything beneath it. Blend modes made a stack of clips composite; this is
 * the other half — a grade that lives on the timeline rather than on one clip,
 * so it can be moved, trimmed and keyframed like anything else.
 *
 * Modelled as an **asset kind** rather than a flag on the clip, and that is the
 * whole reason the state layer needs almost nothing: a clip pointing at an
 * adjustment asset is an ordinary clip. Add, trim, move, delete, effects,
 * masks, blend mode, opacity and animation all already work on it, and none of
 * their reducers had to learn a new case.
 */

const asset = (kind: string) => ({
  id: "asset-adjust",
  projectId: "project-1",
  kind,
  originalUri: "adjustment:",
  checksum: "0".repeat(64),
  metadata: { fileSizeBytes: "0", durationUs: "3600000000" },
  createdAt: "2026-01-01T00:00:00.000Z",
});

describe("the adjustment asset kind", () => {
  it("is a kind the schema accepts", () => {
    expect(assetKindSchema.parse("adjustment")).toBe("adjustment");
  });

  it("parses as an asset like any other", () => {
    // No file behind it, so the uri is a scheme rather than a path — but the
    // shape is unchanged, which is what lets every existing command work.
    expect(mediaAssetSchema.parse(asset("adjustment")).kind).toBe("adjustment");
  });

  it("still refuses a kind nobody defined", () => {
    expect(assetKindSchema.safeParse("adjustments").success).toBe(false);
    expect(mediaAssetSchema.safeParse(asset("filter")).success).toBe(false);
  });
});

describe("where an adjustment layer may be placed", () => {
  it("belongs on a video track", () => {
    // It adjusts a picture, so it lives where pictures are.
    expect(isAssetCompatibleWithTrack("video", "adjustment")).toBe(true);
  });

  it("is refused on an audio track", () => {
    // There is nothing beneath it there to adjust, and its effects are all
    // visual — a silent clip that did nothing would be a trap, not a feature.
    expect(isAssetCompatibleWithTrack("audio", "adjustment")).toBe(false);
  });

  it("leaves every other compatibility rule alone", () => {
    expect(isAssetCompatibleWithTrack("video", "video")).toBe(true);
    expect(isAssetCompatibleWithTrack("video", "image")).toBe(true);
    expect(isAssetCompatibleWithTrack("video", "generated")).toBe(true);
    expect(isAssetCompatibleWithTrack("video", "audio")).toBe(false);
    expect(isAssetCompatibleWithTrack("audio", "audio")).toBe(true);
    expect(isAssetCompatibleWithTrack("audio", "video")).toBe(true);
    expect(isAssetCompatibleWithTrack("audio", "image")).toBe(false);
  });
});
