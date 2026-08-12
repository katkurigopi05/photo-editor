import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  importMedia,
  previewSignature,
  setMode,
  signatureDistance,
} from "./helpers.js";

/**
 * Adjustment layers.
 *
 * A clip with no picture of its own, whose effects apply to everything beneath
 * it. Blend modes made a stack of clips composite; this is the other half — a
 * grade that lives on the timeline instead of on one clip.
 *
 * The claim worth testing is not "an effect changed the picture" but *which*
 * picture it changed: everything below the layer and nothing above it. A test
 * that only checked the frame changed would pass for an effect applied to the
 * adjustment clip's own (non-existent) media, or to the whole canvas
 * unconditionally.
 */

const SOURCE = "video/motion-1280x720-5s.mp4";

async function addAdjustment(page: Page): Promise<void> {
  await page.click("#btn-add-adjustment");
  await page.waitForTimeout(900);
}

/** Apply a one-click Look to the selected clip. A Look rather than a bare
 * effect because most effects default to a no-op — Brightness starts at 0 —
 * so applying one and measuring would prove nothing. */
async function applyLook(page: Page, label: string): Promise<void> {
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll("#looks-row *")].find(
      (node) => (node.textContent ?? "").trim() === name,
    ) as HTMLElement | undefined;
    el?.click();
  }, label);
  await page.waitForTimeout(1200);
}

test("an adjustment layer changes the clip beneath it", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");

  await addAdjustment(page);
  // Adding one carries no effects yet, and it also seeks the playhead onto the
  // new clip — so this, not the pre-add frame, is the baseline. Comparing
  // against the pre-add frame would measure the seek, not the layer.
  const empty = await previewSignature(page);

  // The layer is added selected, so the Look lands on it.
  await applyLook(page, "Cinematic");
  const graded = await previewSignature(page);

  // The adjustment clip has no picture of its own, so it cannot have changed
  // its own appearance — any change at all had to reach the clip underneath.
  expect(signatureDistance(empty, graded)).toBeGreaterThan(2);

  // Removing the Look puts the picture back, which rules out the grade having
  // been burned into something rather than composited each frame.
  await page.click("#btn-undo");
  await page.waitForTimeout(1200);
  const undone = await previewSignature(page);
  expect(signatureDistance(empty, undone)).toBeLessThan(
    signatureDistance(empty, graded),
  );
});

test("the layer sits above the clips, which moved down a track", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await expect(page.locator(".track-row")).toHaveCount(2);

  await addAdjustment(page);

  // A video track was added beneath and the media moved onto it, leaving the
  // top track for the adjustment — the only arrangement in which it is above
  // anything, since the lowest track index paints on top.
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll(".track-row")].map((t) =>
      [...t.querySelectorAll(".clip")].length,
    ),
  );
  expect(rows[0]).toBe(1); // the adjustment layer, alone on top
  expect(rows.slice(1).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
});

test("adding one is a single Undo", async ({ page }) => {
  // It is a run of commands — add a track, move every clip, register an asset,
  // add a clip — and undoing it should not walk back through each.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  const trackCount = await page.locator(".track-row").count();

  await addAdjustment(page);
  expect(await page.locator(".track-row").count()).toBe(trackCount + 1);

  await page.click("#btn-undo");
  await page.waitForTimeout(900);
  expect(await page.locator(".track-row").count()).toBe(trackCount);
});

test("it needs something to adjust", async ({ page }) => {
  // On an empty timeline there is nothing beneath, and a layer that silently
  // did nothing would look broken rather than empty.
  await page.goto("/", { waitUntil: "networkidle" });
  await setMode(page, "video");
  await addAdjustment(page);
  await expect(page.locator(".clip")).toHaveCount(0);
});
