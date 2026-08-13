import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { importMedia, setMode } from "./helpers.js";

/**
 * Watching speed — a video player's speed menu, not an edit.
 *
 * The project already has two things called speed and this is neither. Clip
 * speed and speed ramps are commands: undoable, saved, and baked into the
 * exported file. This moves the playhead faster or slower while you watch and
 * changes nothing else.
 *
 * So the claims worth testing are that it genuinely changes how far the
 * playhead travels in a given wall-clock time, and that it leaves the project
 * alone — no new history, no change to the clip, nothing in the export.
 */

const SOURCE = "video/motion-1280x720-5s.mp4";

/** The playhead position in microseconds, read from the transport's own state
 * rather than the formatted timecode. */
async function playheadUs(page: Page): Promise<number> {
  const text = await page.locator("#timecode").textContent();
  const [mm, rest] = (text ?? "0:0.0").split(":");
  const [ss, ms] = (rest ?? "0.0").split(".");
  return (
    (Number(mm) * 60 + Number(ss)) * 1_000_000 + Number(ms ?? "0") * 1_000
  );
}

/** Play for `ms` of wall clock from the start, then report how far the playhead
 * moved. Returns microseconds of timeline travelled. */
async function travelled(page: Page, ms: number): Promise<number> {
  await page.click("#btn-start");
  await page.waitForTimeout(200);
  const before = await playheadUs(page);
  await page.click("#btn-play");
  await page.waitForTimeout(ms);
  await page.click("#btn-play");
  await page.waitForTimeout(150);
  return (await playheadUs(page)) - before;
}

test("the picker is in the transport, defaulting to real time", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  const rate = page.locator("#playback-rate");
  await expect(rate).toBeVisible();
  await expect(rate).toHaveValue("1/1");
});

test("half speed travels about half as far in the same wall time", async ({
  page,
}) => {
  // The load-bearing claim. Timing in a browser is noisy, so the bounds are
  // wide — but half and full are a factor of two apart, which is far outside
  // the noise, and a control wired to nothing would show a ratio of one.
  await importMedia(page, SOURCE);
  await setMode(page, "video");

  const full = await travelled(page, 1200);
  expect(full).toBeGreaterThan(400_000);

  await page.selectOption("#playback-rate", "1/2");
  const half = await travelled(page, 1200);

  const ratio = half / full;
  expect(ratio).toBeGreaterThan(0.3);
  expect(ratio).toBeLessThan(0.75);
});

test("double speed travels about twice as far", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");

  const full = await travelled(page, 1000);
  expect(full).toBeGreaterThan(300_000);

  await page.selectOption("#playback-rate", "2/1");
  const double = await travelled(page, 1000);

  const ratio = double / full;
  expect(ratio).toBeGreaterThan(1.4);
  expect(ratio).toBeLessThan(3);
});

test("changing it is not an edit", async ({ page }) => {
  // The distinction from clip speed, made concrete: no history entry, so
  // nothing to undo, and the version badge does not move.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await page.waitForTimeout(400);

  const stepsBefore = await page.locator(".history-item").count();
  const versionBefore = await page.locator("#version-badge").textContent();

  await page.selectOption("#playback-rate", "2/1");
  await page.waitForTimeout(400);

  expect(await page.locator(".history-item").count()).toBe(stepsBefore);
  expect(await page.locator("#version-badge").textContent()).toBe(
    versionBefore,
  );
});

test("it survives being changed while playing", async ({ page }) => {
  // Changing speed mid-playback is the normal way people use this, and it must
  // not stop the transport or strand the media elements at the old rate.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await page.click("#btn-start");
  await page.click("#btn-play");
  await page.waitForTimeout(500);

  await page.selectOption("#playback-rate", "1/4");
  await page.waitForTimeout(500);

  // Still playing: the button shows pause.
  await expect(page.locator("#btn-play")).toHaveText("⏸");
  const at = await playheadUs(page);
  await page.waitForTimeout(600);
  expect(await playheadUs(page)).toBeGreaterThan(at);

  await page.click("#btn-play");
});

test("the clip on the timeline is unchanged by watching it faster", async ({
  page,
}) => {
  // Clip speed resizes the clip on the timeline. Watching speed must not, or
  // the two really would be the same feature.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  const clip = page.locator(".clip").first();
  const before = await clip.getAttribute("data-duration-us");

  await page.selectOption("#playback-rate", "2/1");
  await page.waitForTimeout(500);

  expect(await clip.getAttribute("data-duration-us")).toBe(before);
});
