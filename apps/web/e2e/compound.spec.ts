import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  importMedia,
  previewSignature,
  setMode,
  signatureDistance,
} from "./helpers.js";

/**
 * Compound clips through the real toolbar.
 *
 * A run of clips becomes one clip that plays them. The claims that matter are
 * that the picture does not change — compounding is a rearrangement, not an
 * edit — and that a grade carried on a clip survives the move, because
 * `add_clip` takes no effects and a naive implementation would discard them
 * silently.
 */

const SOURCE = "video/motion-1280x720-5s.mp4";

async function clipCount(page: Page): Promise<number> {
  return page.locator(".clip").count();
}

async function addClips(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await page.locator(".media-item").first().click();
    await page.waitForTimeout(500);
  }
}

async function selectAll(page: Page): Promise<void> {
  const clips = page.locator(".clip");
  const n = await clips.count();
  await clips.nth(0).click();
  for (let i = 1; i < n; i += 1) {
    await clips.nth(i).click({ modifiers: ["Shift"] });
  }
  await page.waitForTimeout(300);
}

test("a selection becomes one clip that plays it", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 2);
  const before = await clipCount(page);
  expect(before).toBeGreaterThanOrEqual(3);

  await selectAll(page);
  await page.click("#btn-make-compound");
  await page.waitForTimeout(1200);

  // Many clips in, one out.
  expect(await clipCount(page)).toBe(1);
});

test("the picture is unchanged by compounding", async ({ page }) => {
  // Compounding rearranges where clips live; it is not an edit, and the frame
  // at a given instant must be the same before and after.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await page.waitForTimeout(600);

  // Baseline taken *after* selecting, because selecting seeks the playhead onto
  // the clip. Measured from before, this would report the seek rather than the
  // compound — and would fail while the feature was working.
  await selectAll(page);
  const before = await previewSignature(page);

  await page.click("#btn-make-compound");
  await page.waitForTimeout(1500);

  const after = await previewSignature(page);
  expect(signatureDistance(before, after)).toBeLessThan(6);

  // And the frame is a real picture, not a black one — two blank frames would
  // also be "unchanged", which is how this check could pass while broken.
  const spread = Math.sqrt(
    after.reduce((sum, v) => {
      const mean = after.reduce((a, b) => a + b, 0) / after.length;
      return sum + (v - mean) ** 2;
    }, 0) / after.length,
  );
  expect(spread).toBeGreaterThan(5);
});

test("a grade on a clip survives being compounded", async ({ page }) => {
  // add_clip takes no effects, so a naive implementation would move the timing
  // and drop the look — a loss noticed much later and impossible to undo out of.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await page.locator(".clip").first().click();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("#looks-row *")].find(
      (node) => (node.textContent ?? "").trim() === "Cinematic",
    ) as HTMLElement | undefined;
    el?.click();
  });
  await page.waitForTimeout(1200);
  const graded = await previewSignature(page);

  await selectAll(page);
  await page.click("#btn-make-compound");
  await page.waitForTimeout(1500);

  const compounded = await previewSignature(page);
  expect(signatureDistance(graded, compounded)).toBeLessThan(6);
});

test("compounding is one Undo", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 2);
  const before = await clipCount(page);

  await selectAll(page);
  await page.click("#btn-make-compound");
  await page.waitForTimeout(1200);
  expect(await clipCount(page)).toBe(1);

  await page.click("#btn-undo");
  await page.waitForTimeout(1200);
  expect(await clipCount(page)).toBe(before);
});
