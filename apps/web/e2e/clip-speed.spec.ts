import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  downloadBytes,
  importMedia,
  previewSignature,
  seekFraction,
  setMode,
  signatureDistance,
} from "./helpers.js";

/**
 * Clip speed.
 *
 * Retiming is the one edit that changes how much timeline a clip occupies, so
 * the ways it goes wrong are all structural: the clip's box does not change
 * width, the preview keeps showing the frame it would have shown at 1×, or the
 * export writes a file of the old length. Each is checked here against what the
 * running app actually produced.
 */

async function setSpeed(page: Page, label: string): Promise<void> {
  await page.evaluate((text) => {
    const select = document.querySelector(
      'select[aria-label="Clip speed"]',
    ) as HTMLSelectElement;
    const option = [...select.options].find((o) => o.text === text)!;
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, label);
  await page.waitForTimeout(700);
}

async function clipWidth(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.round(document.querySelector(".clip")!.getBoundingClientRect().width),
  );
}

async function sequenceDurationText(page: Page): Promise<string> {
  return page.evaluate(
    () => document.getElementById("duration")?.textContent?.trim() ?? "",
  );
}

test("doubling the speed halves the clip on the timeline", async ({ page }) => {
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");
  const before = await clipWidth(page);
  const durationBefore = await sequenceDurationText(page);

  await setSpeed(page, "2×");

  expect(await clipWidth(page)).toBeLessThan(before * 0.6);
  expect(await sequenceDurationText(page)).not.toBe(durationBefore);

  // And one Undo puts it back — the retime plus its ripple are one gesture.
  await page.click("#btn-undo");
  await page.waitForTimeout(600);
  expect(await clipWidth(page)).toBe(before);
});

test("halving the speed shows an earlier source frame at the same instant", async ({
  page,
}) => {
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");

  // A fixed instant, a fifth of the way into the original five seconds.
  await seekFraction(page, 200);
  await page.waitForTimeout(800);
  const atNormalSpeed = await previewSignature(page);

  await setSpeed(page, "0.5×");
  // The sequence is now twice as long, so the same *fraction* is a different
  // instant; seek to the same absolute time instead.
  await seekFraction(page, 100);
  await page.waitForTimeout(1000);
  const atHalfSpeed = await previewSignature(page);

  // Same timeline instant, half the source consumed: a different frame.
  await seekFraction(page, 200);
  await page.waitForTimeout(1000);
  const laterAtHalfSpeed = await previewSignature(page);

  expect(signatureDistance(atHalfSpeed, laterAtHalfSpeed)).toBeGreaterThan(1);
  expect(signatureDistance(atNormalSpeed, atHalfSpeed)).toBeGreaterThan(1);
});

test("a retimed clip exports at its new length", async ({ page }) => {
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");
  await setSpeed(page, "2×");

  await page.evaluate(() => {
    const el = document.getElementById("export-resolution") as HTMLSelectElement;
    el.value = "854x480";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.click("#btn-export");
  await page.waitForTimeout(500);
  const bytes = await downloadBytes(page, "#btn-export-start");

  const duration = await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bin], { type: "video/mp4" }));
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("exported mp4 failed to load"));
    });
    URL.revokeObjectURL(url);
    return video.duration;
  }, bytes.toString("base64"));

  // Five seconds of source at 2x is two and a half seconds of output.
  expect(duration).toBeGreaterThan(2);
  expect(duration).toBeLessThan(3.2);
});
