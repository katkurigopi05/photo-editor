import { describe, expect, it } from "vitest";
import { mediaAssetSchema } from "../src/index.js";

const asset = {
  id: "asset-1",
  projectId: "project-1",
  kind: "image" as const,
  originalUri: "file:///photo.jpg",
  checksum: "0".repeat(64),
  metadata: { fileSizeBytes: "100" },
  createdAt: "2026-08-07T00:00:00.000Z",
};

describe("media asset ratings", () => {
  it.each(["favorite", "rejected"] as const)("accepts %s", (rating) => {
    expect(mediaAssetSchema.safeParse({ ...asset, rating }).success).toBe(true);
  });

  it("keeps rating optional for older projects", () => {
    const parsed = mediaAssetSchema.parse(asset);
    expect(parsed).not.toHaveProperty("rating");
  });

  it("rejects unknown ratings and unknown fields", () => {
    expect(
      mediaAssetSchema.safeParse({ ...asset, rating: "maybe" }).success,
    ).toBe(false);
    expect(
      mediaAssetSchema.safeParse({ ...asset, starred: true }).success,
    ).toBe(false);
  });
});
