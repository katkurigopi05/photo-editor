import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { importMedia, setMode } from "./helpers.js";

/**
 * Magnetic tracks through the real timeline.
 *
 * One invariant: on a magnetic track each clip starts where the previous ended.
 * What has to be true here is that ordinary commands inherit it — deleting
 * closes the gap without `delete_clip` knowing magnetism exists — and that an
 * unmarked track is untouched, since that is the whole reason for doing this
 * per track rather than for the timeline.
 */

const SOURCE = "video/motion-1280x720-5s.mp4";

/** Every clip's start and duration on the first video track. */
async function layout(page: Page): Promise<Array<[number, number]>> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".track-row")][0]!
      .querySelectorAll(".clip")
      .values()
      .toArray()
      .map((c) => [
        Number((c as HTMLElement).dataset.startUs ?? "-1"),
        Number((c as HTMLElement).dataset.durationUs ?? "0"),
      ]) as Array<[number, number]>,
  );
}

/** Gaps between consecutive clips, in microseconds. */
function gaps(rows: Array<[number, number]>): number[] {
  const out: number[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    out.push(rows[i]![0] - (rows[i - 1]![0] + rows[i - 1]![1]));
  }
  return out;
}

async function addClips(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await page.locator(".media-item").first().click();
    await page.waitForTimeout(500);
  }
}

async function toggleMagnetic(page: Page): Promise<void> {
  await page.locator(".track-magnet").first().click();
  await page.waitForTimeout(700);
}

test("an ordinary track keeps its gaps", async ({ page }) => {
  // The default, and the reason this is per track: everything already built on
  // free lanes has to keep working.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 1);
  await page.locator(".clip").first().click();
  await page.waitForTimeout(300);
  await page.click("#btn-delete");
  await page.waitForTimeout(700);

  const rows = await layout(page);
  // The survivor stayed where it was rather than sliding to zero.
  expect(rows[0]![0]).toBeGreaterThan(0);
});

test("deleting on a magnetic track closes the gap", async ({ page }) => {
  // delete_clip knows nothing about magnetism; it inherits the invariant.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 2);
  await toggleMagnetic(page);

  await page.locator(".clip").first().click();
  await page.waitForTimeout(300);
  await page.click("#btn-delete");
  await page.waitForTimeout(800);

  const rows = await layout(page);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]![0]).toBe(0);
  expect(gaps(rows).every((g) => g === 0)).toBe(true);
});

test("turning it on packs the track immediately", async ({ page }) => {
  // Visible at once rather than at the next edit, or the toggle would look
  // like it had done nothing.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 2);

  await toggleMagnetic(page);
  const rows = await layout(page);
  expect(rows[0]![0]).toBe(0);
  expect(gaps(rows).every((g) => g === 0)).toBe(true);
});

test("the toggle reports its state and undoes", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 1);

  const magnet = page.locator(".track-magnet").first();
  await expect(magnet).toHaveAttribute("aria-pressed", "false");
  await toggleMagnetic(page);
  await expect(magnet).toHaveAttribute("aria-pressed", "true");

  await page.click("#btn-undo");
  await page.waitForTimeout(700);
  await expect(page.locator(".track-magnet").first()).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
