import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  importMedia,
  previewSignature,
  seekFraction,
  setMode,
  signatureDistance,
} from "./helpers.js";

/**
 * Speed ramps through the real Inspector.
 *
 * A ramp is stepped: constant rational rates between boundaries, so every
 * source instant stays exactly computable. What has to be true at this level is
 * what the unit tests cannot see — that the Inspector reaches the command, that
 * the clip on screen grows by the right amount, and that the *picture* is
 * retimed rather than merely the box being longer.
 */

const SOURCE = "video/motion-1280x720-5s.mp4";

async function selectClip(page: Page): Promise<void> {
  await page.locator(".clip").first().click();
  await page.waitForTimeout(400);
}

async function clipDurations(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".clip")].map((clip) =>
      Number((clip as HTMLElement).dataset.durationUs ?? "0"),
    ),
  );
}

/** Put the playhead a fraction into the sequence and add a speed change. */
async function addSpeedChangeAt(page: Page, permille: number): Promise<void> {
  await seekFraction(page, permille);
  await page.waitForTimeout(400);
  await selectClip(page);
  await seekFraction(page, permille);
  await page.waitForTimeout(400);
  await page.click("#btn-add-speed-change");
  await page.waitForTimeout(700);
}

test("a speed change lengthens the clip by the segment it slows", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  expect(await clipDurations(page)).toEqual([5_000_000]);

  // Halfway in: 2.5s of source plays on, at half speed, so the back half takes
  // five seconds instead of two and a half.
  await addSpeedChangeAt(page, 500);

  expect(await clipDurations(page)).toEqual([7_500_000]);
  // Two segments now: the clip's original rate, then the half-speed one.
  await expect(page.locator(".ramp-row")).toHaveCount(2);
});

test("the ramp is one undo, and clearing it restores the length", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addSpeedChangeAt(page, 500);
  expect(await clipDurations(page)).toEqual([7_500_000]);

  await page.click("#btn-undo");
  await page.waitForTimeout(600);
  expect(await clipDurations(page)).toEqual([5_000_000]);
  await expect(page.locator(".ramp-row")).toHaveCount(0);

  await page.click("#btn-redo");
  await page.waitForTimeout(600);
  expect(await clipDurations(page)).toEqual([7_500_000]);

  await selectClip(page);
  await page.click("#btn-clear-ramp");
  await page.waitForTimeout(700);
  expect(await clipDurations(page)).toEqual([5_000_000]);
});

test("the picture is retimed, not just the box", async ({ page }) => {
  // The failure this rules out is a clip that is drawn longer while still
  // showing its original frame at each instant — which a duration assertion
  // alone would happily pass.
  await importMedia(page, SOURCE);
  await setMode(page, "video");

  // Three-quarters through the untouched 5s clip is 3.75s of source.
  await seekFraction(page, 750);
  await page.waitForTimeout(900);
  const beforeRamp = await previewSignature(page);

  await addSpeedChangeAt(page, 500);

  // Now the clip is 7.5s. Three-quarters through it is 5.625s of timeline,
  // which is 2.5s + (3.125s at half speed) = 3.0625s of source — an earlier
  // frame than the 3.75s the same fraction showed before.
  await seekFraction(page, 750);
  await page.waitForTimeout(900);
  const afterRamp = await previewSignature(page);

  expect(signatureDistance(beforeRamp, afterRamp)).toBeGreaterThan(2);
});

test("the constant-speed picker is disabled while a ramp is in force", async ({
  page,
}) => {
  // Two descriptions of one clip's speed must not both be offered: the reducer
  // refuses a constant rate on a ramped clip, so the UI must not invite one.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await selectClip(page);
  await expect(page.getByLabel("Clip speed")).toBeEnabled();

  await addSpeedChangeAt(page, 500);
  await expect(page.getByLabel("Clip speed")).toBeDisabled();

  await page.click("#btn-clear-ramp");
  await page.waitForTimeout(700);
  await selectClip(page);
  await expect(page.getByLabel("Clip speed")).toBeEnabled();
});
