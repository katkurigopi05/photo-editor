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
 * Choosing part of a shot before it reaches the timeline.
 *
 * Final Cut's browser range: decide which part you want first, rather than
 * adding the whole thing and trimming it back. What has to be true is that the
 * clip which lands on the timeline carries the chosen window — its duration and
 * its source in-point — and that the choice survives being used more than once.
 */

const SOURCE = "video/motion-1280x720-5s.mp4";

async function openRange(page: Page): Promise<void> {
  await page.locator(".media-range-btn").first().click();
  await page.waitForTimeout(300);
}

async function setSlider(
  page: Page,
  label: string,
  value: number,
): Promise<void> {
  const slider = page.locator(`input[type="range"][aria-label^="${label}"]`);
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await page.waitForTimeout(200);
}

/** Durations of the clips on the timeline, in microseconds. */
async function clipDurations(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".clip")].map((clip) =>
      Number((clip as HTMLElement).dataset.durationUs ?? "0"),
    ),
  );
}

test("a range decides the length of the clip that is added", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  // Import already placed the whole five seconds.
  expect(await clipDurations(page)).toEqual([5_000_000]);

  await openRange(page);
  await setSlider(page, "In", 1_000_000);
  await setSlider(page, "Out", 3_000_000);
  await page.getByRole("button", { name: "Use range" }).click();
  await page.waitForTimeout(500);

  // The bin says what will be added.
  await expect(page.locator(".media-range-label")).toContainText("00:01.000");

  await page.locator(".media-item").first().click();
  await page.waitForTimeout(600);

  const durations = await clipDurations(page);
  expect(durations).toHaveLength(2);
  expect(durations[1]).toBe(2_000_000);
});

test("the range is a window into the source, not just a length", async ({
  page,
}) => {
  // Duration alone would pass for a clip that started at zero and simply ran
  // short, which is the thing this has to rule out: the added clip must show
  // the picture from three seconds in.
  await importMedia(page, SOURCE);
  await setMode(page, "video");

  // What the source looks like at 0s and at 3s, read from the original clip.
  await seekFraction(page, 0);
  await page.waitForTimeout(900);
  const atZero = await previewSignature(page);
  await seekFraction(page, 600); // 3s of the 5s clip
  await page.waitForTimeout(900);
  const atThree = await previewSignature(page);
  expect(signatureDistance(atZero, atThree)).toBeGreaterThan(3);

  await openRange(page);
  await setSlider(page, "In", 3_000_000);
  await setSlider(page, "Out", 4_000_000);
  await page.getByRole("button", { name: "Use range" }).click();
  await page.waitForTimeout(400);
  await page.locator(".media-item").first().click();
  await page.waitForTimeout(900);

  // The sequence is now 6s: the original five plus this one. Its first frame
  // is at 5s on the timeline.
  await seekFraction(page, Math.round((5.02 / 6) * 1000));
  await page.waitForTimeout(1200);
  const atRangeStart = await previewSignature(page);

  // It matches the source at three seconds, not the source at zero.
  expect(signatureDistance(atRangeStart, atThree)).toBeLessThan(
    signatureDistance(atRangeStart, atZero),
  );
});

test("Whole clip clears the range", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");

  await openRange(page);
  await setSlider(page, "Out", 2_000_000);
  await page.getByRole("button", { name: "Use range" }).click();
  await page.waitForTimeout(400);
  await expect(page.locator(".media-range-label")).toHaveCount(1);

  await openRange(page);
  await page.getByRole("button", { name: "Whole clip" }).click();
  await page.waitForTimeout(400);
  await expect(page.locator(".media-range-label")).toHaveCount(0);

  await page.locator(".media-item").first().click();
  await page.waitForTimeout(600);
  const durations = await clipDurations(page);
  expect(durations[durations.length - 1]).toBe(5_000_000);
});

test("In cannot cross Out", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await openRange(page);

  await setSlider(page, "Out", 2_000_000);
  // Drag In well past Out: it is pinned just short of it rather than allowed
  // to describe a backwards range.
  await setSlider(page, "In", 4_500_000);
  await page.getByRole("button", { name: "Use range" }).click();
  await page.waitForTimeout(400);

  await page.locator(".media-item").first().click();
  await page.waitForTimeout(600);
  const durations = await clipDurations(page);
  expect(durations[durations.length - 1]).toBeGreaterThan(0);
  expect(durations[durations.length - 1]).toBeLessThanOrEqual(2_000_000);
});
