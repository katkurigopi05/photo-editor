import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { importMedia, setMode } from "./helpers.js";

/**
 * Following a feature and holding it still.
 *
 * The tracker is unit-tested against synthetic frames it generates itself. What
 * only this can check is the wiring: that a click on the picker becomes a
 * tracker coordinate, that real decoded frames reach the tracker, that the
 * result becomes keyframes, and that a feature with nothing to lock onto is
 * reported rather than followed into nonsense.
 */

const SOURCE = "video/motion-1280x720-5s.mp4";

async function selectFirstClip(page: Page): Promise<void> {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await page.locator(".clip").first().click();
  await page.waitForTimeout(600);
}

/**
 * Click the picker at a fraction of its size.
 *
 * `locator.click({ position })` rather than `page.mouse.click`, because the
 * inspector is long and the picker sits around y=2450 — well below the
 * viewport. `page.mouse` takes *viewport* coordinates, so a bounding-box click
 * lands on nothing and the test fails against a working control. The locator
 * form scrolls it into view first. This is the second time this trap has been
 * hit in this repo; the first is in LESSONS.md.
 */
async function pick(page: Page, fx: number, fy: number): Promise<void> {
  const picker = page.locator("#track-picker");
  const box = await picker.boundingBox();
  if (!box) throw new Error("picker not visible");
  await picker.click({
    position: { x: box.width * fx, y: box.height * fy },
  });
  await page.waitForTimeout(300);
}

/** Wait on the keyframes, not on the toast — a toast is a shared slot anything
 * may overwrite, which broke the stabilise tests before. */
async function waitForTracked(page: Page, before: number): Promise<void> {
  await page.waitForFunction(
    (n) => document.querySelectorAll(".clip-keyframe-marker").length > n,
    before,
    { timeout: 240_000 },
  );
}

test("the picker and button appear for a video clip", async ({ page }) => {
  await selectFirstClip(page);
  await expect(page.locator("#track-picker")).toBeVisible();
  // Nothing picked yet, so there is nothing to track.
  await expect(page.locator("#btn-track")).toBeDisabled();
});

test("picking a feature enables tracking", async ({ page }) => {
  await selectFirstClip(page);
  await pick(page, 0.5, 0.5);
  await expect(page.locator("#btn-track")).toBeEnabled();
});

test("tracking writes position keyframes onto the clip", async ({ page }) => {
  test.setTimeout(300_000);
  await selectFirstClip(page);
  const before = await page.locator(".clip-keyframe-marker").count();

  // The circle, deliberately. The rest of this fixture is a field of diagonal
  // stripes, which cannot be tracked at all: gradients are strong across a
  // stripe and nearly zero along it, so there is no way to tell where along it
  // you are. Picking one is the aperture problem, and the tracker correctly
  // refuses — see the last test here.
  await pick(page, 0.09, 0.5);
  await page.click("#btn-track");
  await waitForTracked(page, before);

  expect(await page.locator(".clip-keyframe-marker").count()).toBeGreaterThan(
    before,
  );
});

test("it is one Undo", async ({ page }) => {
  test.setTimeout(300_000);
  await selectFirstClip(page);
  const before = await page.locator(".clip-keyframe-marker").count();

  await pick(page, 0.09, 0.5);
  await page.click("#btn-track");
  await waitForTracked(page, before);

  await page.click("#btn-undo");
  await page.waitForTimeout(1200);
  expect(await page.locator(".clip-keyframe-marker").count()).toBe(before);
});

test("tracking is refused on an already-animated clip, promptly", async ({
  page,
}) => {
  // Same rule as stabilising, and for the same reason: applying it would
  // replace hand-keyed work, and being told after a slow analysis is worse
  // than being told at once.
  await selectFirstClip(page);
  await page.selectOption('[aria-label="Auto animation preset"]', { index: 1 });
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForTimeout(900);

  await pick(page, 0.09, 0.5);
  const start = Date.now();
  await page.click("#btn-track");
  await expect(page.locator("#toast")).toContainText("already animated", {
    timeout: 10_000,
  });
  expect(Date.now() - start).toBeLessThan(10_000);
  await expect(page.locator("#toast")).toHaveClass(/error/);
});

test("a region with nothing to lock onto is refused, not followed", async ({
  page,
}) => {
  // The honest-failure path, and the one a user will hit most. The stripes have
  // structure in one direction only; a tracker without an eigenvalue check
  // returns a confident number here and follows the pattern sideways forever.
  test.setTimeout(300_000);
  await selectFirstClip(page);
  const before = await page.locator(".clip-keyframe-marker").count();

  await pick(page, 0.5, 0.5);
  await page.click("#btn-track");
  await expect(page.locator("#toast")).toContainText("Lost the feature", {
    timeout: 240_000,
  });
  await expect(page.locator("#toast")).toHaveClass(/error/);
  // And nothing was written: a refusal, not a bad track.
  expect(await page.locator(".clip-keyframe-marker").count()).toBe(before);
});
