import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { importMedia, setMode } from "./helpers.js";

/**
 * Stabilising a shot, through the real inspector.
 *
 * The package that measures the motion is unit-tested against synthetic frames
 * it generates itself. What cannot be tested there is everything this touches:
 * that real decoded frames reach the analyser, that the result becomes
 * *keyframes on the clip*, that it is one Undo, and that the refusals fire
 * before the slow part rather than after it.
 *
 * Deliberately not asserted: how much shake is removed. The fixture is a clean
 * synthetic render with almost no camera motion, so the honest claim is that
 * the pipeline runs end to end and produces well-formed animation — not that it
 * rescued footage that was never shaky.
 */

const SOURCE = "video/motion-1280x720-5s.mp4";

/**
 * Wait for the keyframes to land, not for the toast to say so.
 *
 * The first version of these tests waited on the toast text and failed against
 * a working feature. Analysis takes about 30 seconds for a 5-second clip, and
 * the proxy builder finishes partway through and replaces the message with its
 * own. A toast is a single shared surface anything may overwrite, so it is a
 * status display and never a signal — the keyframes are the thing being
 * claimed, so they are the thing to wait for.
 */
async function waitForStabilised(page: Page, before: number): Promise<void> {
  await page.waitForFunction(
    (n) => document.querySelectorAll(".clip-keyframe-marker").length > n,
    before,
    { timeout: 240_000 },
  );
}

async function selectFirstClip(page: Page): Promise<void> {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await page.locator(".clip").first().click();
  await page.waitForTimeout(500);
}

test("the control appears for a video clip", async ({ page }) => {
  await selectFirstClip(page);
  await expect(page.locator("#btn-stabilise")).toBeVisible();
});

test("stabilising writes transform keyframes onto the clip", async ({
  page,
}) => {
  // Decoding every frame is genuinely slow — measured at ~30s for this clip.
  test.setTimeout(300_000);
  await selectFirstClip(page);
  const before = await page.locator(".clip-keyframe-marker").count();

  await page.click("#btn-stabilise");
  await waitForStabilised(page, before);

  // The measurement became project state rather than staying in a variable.
  expect(await page.locator(".clip-keyframe-marker").count()).toBeGreaterThan(
    before,
  );
});

test("it is one Undo", async ({ page }) => {
  test.setTimeout(300_000);
  await selectFirstClip(page);
  const before = await page.locator(".clip-keyframe-marker").count();

  await page.click("#btn-stabilise");
  await waitForStabilised(page, before);
  expect(await page.locator(".clip-keyframe-marker").count()).toBeGreaterThan(
    before,
  );

  // Four tracks written in one gesture must come back off in one press.
  await page.click("#btn-undo");
  await page.waitForTimeout(1200);
  expect(await page.locator(".clip-keyframe-marker").count()).toBe(before);
});

test("it refuses a clip that is already animated, before analysing", async ({
  page,
}) => {
  // The refusal has to come first. The analysis takes real time, and being told
  // afterwards that it could never have applied is worse than being told at
  // once — so this asserts the message *and* that it arrived quickly.
  await selectFirstClip(page);

  // Ken Burns writes position and scale keyframes.
  await page.selectOption('[aria-label="Auto animation preset"]', { index: 1 });
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForTimeout(900);

  const start = Date.now();
  await page.click("#btn-stabilise");
  await expect(page.locator("#toast")).toContainText("already animated", {
    timeout: 10_000,
  });
  expect(Date.now() - start).toBeLessThan(10_000);
  await expect(page.locator("#toast")).toHaveClass(/error/);
});
