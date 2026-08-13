import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  importMedia,
  previewSignature,
  setMode,
  signatureDistance,
} from "./helpers.js";

/**
 * Dissolving a compound clip — the way back out.
 *
 * Compounding shipped as a one-way door: a run of clips became one clip whose
 * contents nothing in the app could reach again. The claims worth testing are
 * that dissolving is the *inverse* (the same clips, in the same places, showing
 * the same picture), that it is one Undo like compounding is, and that a
 * compound clip carrying an effect is refused in words rather than quietly
 * losing that effect.
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

/** Clip starts, in microseconds, in timeline order. */
async function clipStarts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".clip")]
      .map((el) => (el as HTMLElement).dataset.startUs ?? "")
      .sort((a, b) => (BigInt(a || "0") < BigInt(b || "0") ? -1 : 1)),
  );
}

async function compoundEverything(page: Page): Promise<void> {
  await selectAll(page);
  await page.click("#btn-make-compound");
  await page.waitForTimeout(1200);
}

test("a compound clip becomes its contents again", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 2);
  const before = await clipCount(page);
  expect(before).toBeGreaterThanOrEqual(3);

  await compoundEverything(page);
  expect(await clipCount(page)).toBe(1);

  await page.click("#btn-dissolve-compound");
  await page.waitForTimeout(1200);
  expect(await clipCount(page)).toBe(before);
});

test("the clips come back where they were, not stacked at zero", async ({
  page,
}) => {
  // The inner sequence rebases the selection to start at zero. Putting that
  // back without re-adding the compound clip's own start would pile every clip
  // onto the head of the timeline — an edit, not a rearrangement.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 2);
  const before = await clipStarts(page);

  await compoundEverything(page);
  await page.click("#btn-dissolve-compound");
  await page.waitForTimeout(1200);

  expect(await clipStarts(page)).toEqual(before);
});

test("the picture is unchanged by dissolving", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await page.waitForTimeout(600);
  await compoundEverything(page);

  // Baseline after compounding has settled and the compound clip is selected —
  // selecting seeks the playhead, so a baseline taken earlier would report the
  // seek rather than the dissolve.
  await page.locator(".clip").first().click();
  await page.waitForTimeout(600);
  const before = await previewSignature(page);

  await page.click("#btn-dissolve-compound");
  await page.waitForTimeout(1500);
  const after = await previewSignature(page);

  expect(signatureDistance(before, after)).toBeLessThan(6);

  // Both frames must be real pictures: two black ones are also "unchanged".
  const mean = after.reduce((a, b) => a + b, 0) / after.length;
  const spread = Math.sqrt(
    after.reduce((sum, v) => sum + (v - mean) ** 2, 0) / after.length,
  );
  expect(spread).toBeGreaterThan(5);
});

test("dissolving is one Undo", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 2);

  await compoundEverything(page);
  expect(await clipCount(page)).toBe(1);

  await page.click("#btn-dissolve-compound");
  await page.waitForTimeout(1200);
  const dissolved = await clipCount(page);
  expect(dissolved).toBeGreaterThan(1);

  await page.click("#btn-undo");
  await page.waitForTimeout(1200);
  expect(await clipCount(page)).toBe(1);
});

test("a grade inside the compound clip survives coming back out", async ({
  page,
}) => {
  // The mirror of the compounding test: add_clip takes no effects on the way
  // out either, so a naive dissolve drops the look it was careful to carry in.
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

  await compoundEverything(page);
  await page.locator(".clip").first().click();
  await page.waitForTimeout(600);
  await page.click("#btn-dissolve-compound");
  await page.waitForTimeout(1500);

  const restored = await previewSignature(page);
  expect(signatureDistance(graded, restored)).toBeLessThan(6);
});

test("a compound clip carrying an effect is refused, and told why", async ({
  page,
}) => {
  // An effect on the compound clip applies to the composite and has no
  // per-clip equivalent. Dissolving anyway would silently change the picture,
  // so it is refused — in words naming the reason, not a generic failure.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await compoundEverything(page);

  await page.locator(".clip").first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("#looks-row *")].find(
      (node) => (node.textContent ?? "").trim() === "Cinematic",
    ) as HTMLElement | undefined;
    el?.click();
  });
  await page.waitForTimeout(1000);

  await page.click("#btn-dissolve-compound");
  await page.waitForTimeout(800);

  // Still one clip: nothing happened.
  expect(await clipCount(page)).toBe(1);
  const toast = page.locator("#toast");
  await expect(toast).toHaveClass(/error/);
  await expect(toast).toContainText("composite");
});

test("an ordinary clip is not dissolvable", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await page.locator(".clip").first().click();
  await page.waitForTimeout(400);
  const before = await clipCount(page);

  await page.click("#btn-dissolve-compound");
  await page.waitForTimeout(600);

  expect(await clipCount(page)).toBe(before);
  await expect(page.locator("#toast")).toContainText("not a compound clip");
});
