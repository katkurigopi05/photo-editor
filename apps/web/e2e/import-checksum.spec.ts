import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { importMedia, MEDIA } from "./helpers.js";

/**
 * Importing without reading the file into memory.
 *
 * Import used to call `file.arrayBuffer()` to checksum, so a file past the
 * browser's ArrayBuffer ceiling could not be imported at all. Hashing is now
 * streamed through a worker — which is only worth anything if the digest is
 * still a real SHA-256 and the import still completes, so this checks both
 * against the file on disk.
 */

test("the checksum of an imported file is its real SHA-256", async ({
  page,
}) => {
  const file = "photos/gradient-landscape-1600x900.png";
  await importMedia(page, file);

  // The operation log carries the registered asset, checksum and all. Read
  // from the entry's data attribute rather than its text: the label is written
  // for people and may be reworded, the command type may not.
  const checksum = await page.evaluate(() =>
    [...document.querySelectorAll("#history-list .history-item")].some(
      (node) => (node as HTMLElement).dataset.commandType === "asset.register",
    ),
  );
  expect(checksum, "the asset registered").toBe(true);

  // Hash the same bytes with Node and compare against what the page stored.
  const expected = createHash("sha256")
    .update(readFileSync(MEDIA + file))
    .digest("hex");

  const stored = await page.evaluate(() => {
    const media = document.querySelector(".media-item");
    return media?.getAttribute("data-checksum") ?? null;
  });
  expect(stored, "the media item exposes the checksum it registered").toBe(
    expected,
  );
});

test("a batch of files all import", async ({ page }) => {
  // Hashing moved to a worker; a batch shares one worker, so a request that
  // mismatched its response would show up here as a missing clip.
  await page.goto("/", { waitUntil: "networkidle" });
  await page.setInputFiles("#file-input", [
    MEDIA + "photos/colour-chart-512x512.jpg",
    MEDIA + "photos/gradient-landscape-1600x900.png",
    MEDIA + "photos/detail-texture-1280x960.jpg",
  ]);
  await expect(page.locator(".media-item")).toHaveCount(3, {
    timeout: 60_000,
  });

  const checksums = await page.evaluate(() =>
    [...document.querySelectorAll(".media-item")].map((node) =>
      node.getAttribute("data-checksum"),
    ),
  );
  expect(new Set(checksums).size, "three distinct checksums").toBe(3);
  for (const value of checksums) expect(value).toMatch(/^[0-9a-f]{64}$/);
});
