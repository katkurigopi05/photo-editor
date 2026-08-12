import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  importMedia,
  previewSignature,
  setMode,
  signatureDistance,
} from "./helpers.js";

/**
 * Opening a compound clip and editing inside it.
 *
 * The last part of the one-way door. Making a compound clip moved its contents
 * into a sequence of their own, and until now nothing could point the editor at
 * that sequence — the app resolved a hardcoded id everywhere.
 *
 * The claims worth testing are that the timeline below actually changes to the
 * inner sequence, that an edit made inside lands *inside* rather than on the
 * root, and that the way back exists and returns you to where you were. The
 * last one matters most: a way in without a way out is the same trap in a new
 * place.
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

/** Two clips compounded into one, selected and ready to open. */
async function compounded(page: Page): Promise<void> {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 2);
  await selectAll(page);
  await page.click("#btn-make-compound");
  await page.waitForTimeout(1200);
  await page.locator(".clip").first().click();
  await page.waitForTimeout(400);
}

test("a compound clip is marked as one", async ({ page }) => {
  await compounded(page);
  await expect(page.locator(".clip.compound")).toHaveCount(1);
});

test("opening it shows its contents on the timeline", async ({ page }) => {
  await compounded(page);
  expect(await clipCount(page)).toBe(1);

  await page.click("#btn-open-compound");
  await page.waitForTimeout(900);

  // Inside are the clips that went in, not the one clip that replaced them.
  expect(await clipCount(page)).toBeGreaterThan(1);
  await expect(page.locator(".clip.compound")).toHaveCount(0);
});

test("double-clicking the clip opens it too", async ({ page }) => {
  // The gesture every other editor uses, and the one people try first.
  await compounded(page);
  await page.locator(".clip").first().dblclick();
  await page.waitForTimeout(900);
  expect(await clipCount(page)).toBeGreaterThan(1);
});

test("the breadcrumb appears only once there is a way back", async ({
  page,
}) => {
  await compounded(page);
  await expect(page.locator("#sequence-path")).toBeHidden();

  await page.click("#btn-open-compound");
  await page.waitForTimeout(900);
  await expect(page.locator("#sequence-path")).toBeVisible();
  await expect(page.locator(".sequence-crumb")).toHaveCount(2);
  // The one you are on is where you are, not a destination.
  await expect(page.locator(".sequence-crumb.current")).toBeDisabled();
});

test("clicking Main goes back out, and the breadcrumb goes with it", async ({
  page,
}) => {
  await compounded(page);
  await page.click("#btn-open-compound");
  await page.waitForTimeout(900);
  const inside = await clipCount(page);

  await page.locator(".sequence-crumb").first().click();
  await page.waitForTimeout(900);

  expect(await clipCount(page)).toBe(1);
  expect(await clipCount(page)).toBeLessThan(inside);
  await expect(page.locator("#sequence-path")).toBeHidden();
});

test("a round trip returns to the frame it started from", async ({ page }) => {
  // Stepping in is meant to be looking closer at what you were already
  // watching, so the playhead follows the frame in and back out again.
  await compounded(page);
  await page.waitForTimeout(600);
  const before = await previewSignature(page);

  await page.click("#btn-open-compound");
  await page.waitForTimeout(1000);
  await page.locator(".sequence-crumb").first().click();
  await page.waitForTimeout(1200);

  const after = await previewSignature(page);
  expect(signatureDistance(before, after)).toBeLessThan(6);

  // Not two blank frames, which would also be "the same".
  const mean = after.reduce((a, b) => a + b, 0) / after.length;
  const spread = Math.sqrt(
    after.reduce((sum, v) => sum + (v - mean) ** 2, 0) / after.length,
  );
  expect(spread).toBeGreaterThan(5);
});

test("an edit made inside lands inside, not on the root", async ({ page }) => {
  // The reason the hardcoded sequence id had to go. A delete dispatched with
  // the root's id while the timeline shows the inner sequence would either be
  // refused or, worse, delete something else entirely.
  await compounded(page);
  await page.click("#btn-open-compound");
  await page.waitForTimeout(900);
  const inside = await clipCount(page);
  expect(inside).toBeGreaterThan(1);

  await page.locator(".clip").first().click();
  await page.waitForTimeout(300);
  await page.click("#btn-delete");
  await page.waitForTimeout(900);
  expect(await clipCount(page)).toBe(inside - 1);

  // And the root still has its single compound clip: nothing leaked outward.
  await page.locator(".sequence-crumb").first().click();
  await page.waitForTimeout(900);
  expect(await clipCount(page)).toBe(1);
});

test("undoing the compound while inside it steps back out", async ({
  page,
}) => {
  // The inner sequence exists because a command created it, so undoing far
  // enough removes the ground you are standing on. Falling back to the root
  // beats an editor showing nothing and refusing every command.
  await compounded(page);
  await page.click("#btn-open-compound");
  await page.waitForTimeout(900);
  expect(await clipCount(page)).toBeGreaterThan(1);

  await page.click("#btn-undo");
  await page.waitForTimeout(1400);

  await expect(page.locator("#sequence-path")).toBeHidden();
  // Back on the root, with the clips the compound was made from.
  expect(await clipCount(page)).toBeGreaterThan(1);
  await expect(page.locator(".clip.compound")).toHaveCount(0);
});

test("an ordinary clip cannot be opened", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await page.locator(".clip").first().click();
  await page.waitForTimeout(400);

  await page.click("#btn-open-compound");
  await page.waitForTimeout(600);

  await expect(page.locator("#sequence-path")).toBeHidden();
  await expect(page.locator("#toast")).toContainText("not a compound clip");
});
