import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  importMedia,
  previewSignature,
  setMode,
  signatureDistance,
} from "./helpers.js";

/**
 * Adjustment layers.
 *
 * A clip with no picture of its own, whose effects apply to everything beneath
 * it. Blend modes made a stack of clips composite; this is the other half — a
 * grade that lives on the timeline instead of on one clip.
 *
 * The claim worth testing is not "an effect changed the picture" but *which*
 * picture it changed: everything below the layer and nothing above it. A test
 * that only checked the frame changed would pass for an effect applied to the
 * adjustment clip's own (non-existent) media, or to the whole canvas
 * unconditionally.
 */

const SOURCE = "video/motion-1280x720-5s.mp4";

async function addAdjustment(page: Page): Promise<void> {
  await page.click("#btn-add-adjustment");
  await page.waitForTimeout(900);
}

/** Apply a one-click Look to the selected clip. A Look rather than a bare
 * effect because most effects default to a no-op — Brightness starts at 0 —
 * so applying one and measuring would prove nothing. */
async function applyLook(page: Page, label: string): Promise<void> {
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll("#looks-row *")].find(
      (node) => (node.textContent ?? "").trim() === name,
    ) as HTMLElement | undefined;
    el?.click();
  }, label);
  await page.waitForTimeout(1200);
}

test("an adjustment layer changes the clip beneath it", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");

  await addAdjustment(page);
  // Adding one carries no effects yet, and it also seeks the playhead onto the
  // new clip — so this, not the pre-add frame, is the baseline. Comparing
  // against the pre-add frame would measure the seek, not the layer.
  const empty = await previewSignature(page);

  // The layer is added selected, so the Look lands on it.
  await applyLook(page, "Cinematic");
  const graded = await previewSignature(page);

  // The adjustment clip has no picture of its own, so it cannot have changed
  // its own appearance — any change at all had to reach the clip underneath.
  expect(signatureDistance(empty, graded)).toBeGreaterThan(2);

  // Removing the Look puts the picture back, which rules out the grade having
  // been burned into something rather than composited each frame.
  await page.click("#btn-undo");
  await page.waitForTimeout(1200);
  const undone = await previewSignature(page);
  expect(signatureDistance(empty, undone)).toBeLessThan(
    signatureDistance(empty, graded),
  );
});

test("the layer sits above the clips, which moved down a track", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await expect(page.locator(".track-row")).toHaveCount(2);

  await addAdjustment(page);

  // A video track was added beneath and the media moved onto it, leaving the
  // top track for the adjustment — the only arrangement in which it is above
  // anything, since the lowest track index paints on top.
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll(".track-row")].map((t) =>
      [...t.querySelectorAll(".clip")].length,
    ),
  );
  expect(rows[0]).toBe(1); // the adjustment layer, alone on top
  expect(rows.slice(1).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
});

test("adding one is a single Undo", async ({ page }) => {
  // It is a run of commands — add a track, move every clip, register an asset,
  // add a clip — and undoing it should not walk back through each.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  const trackCount = await page.locator(".track-row").count();

  await addAdjustment(page);
  expect(await page.locator(".track-row").count()).toBe(trackCount + 1);

  await page.click("#btn-undo");
  await page.waitForTimeout(900);
  expect(await page.locator(".track-row").count()).toBe(trackCount);
});

test("it needs something to adjust", async ({ page }) => {
  // On an empty timeline there is nothing beneath, and a layer that silently
  // did nothing would look broken rather than empty.
  await page.goto("/", { waitUntil: "networkidle" });
  await setMode(page, "video");
  await addAdjustment(page);
  await expect(page.locator(".clip")).toHaveCount(0);
});

test("the preview grade is bounded, and the report says so", async ({
  page,
}) => {
  // The adjustment path grades the live canvas every frame, so its cost
  // follows the preview size and therefore the viewer's screen. The budget
  // must not change what the grade *does* — only how many pixels it does it to.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addAdjustment(page);
  const empty = await previewSignature(page);
  await applyLook(page, "Cinematic");
  const graded = await previewSignature(page);
  expect(signatureDistance(empty, graded)).toBeGreaterThan(2);

  // And the machine's limits are stated rather than left to be discovered.
  await page.click("#btn-export");
  await page.waitForTimeout(600);
  const report = page.locator("#system-capabilities");
  await expect(report).toBeVisible();
  await report.locator("summary").click();
  await expect(report).toContainText("exports always render at full resolution");
});

test("preview quality can be pinned, and the report follows", async ({
  page,
}) => {
  // Auto-scaling measures the machine, but a person may want to overrule it:
  // grading a still deserves the best preview the machine can manage, and a
  // laptop on battery may want the opposite. The setting is machine-personal,
  // so it persists across a reload rather than living in the project.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addAdjustment(page);
  await applyLook(page, "Cinematic");
  const auto = await previewSignature(page);

  await page.click("#btn-export");
  await page.waitForTimeout(500);
  await page.locator("#system-capabilities summary").click();
  await expect(page.locator("#system-capabilities")).toContainText("auto");

  await page.getByLabel("Preview quality").selectOption("low");
  await page.waitForTimeout(800);
  await expect(page.locator("#system-capabilities")).toContainText("fixed at low");

  // Pinning changes how many pixels the grade runs on, not what it does — the
  // picture must still be the graded one, not the ungraded one.
  const pinned = await previewSignature(page);
  expect(signatureDistance(auto, pinned)).toBeLessThan(6);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.click("#btn-export");
  await page.waitForTimeout(500);
  await expect(page.getByLabel("Preview quality")).toHaveValue("low");
});

test("grading through the lookup table matches grading directly", async ({
  page,
}) => {
  // An adjustment layer's stack is collapsed into a 3D colour table, because it
  // regrades the live canvas every frame and cannot cache. A media clip's stack
  // is not — it grades at its own resolution and caches the result. So the two
  // paths run different code, and this is the check that they agree.
  //
  // Same Look, same footage, same frame: once carried by the clip itself, once
  // by an adjustment layer above an untouched clip.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await page.locator(".clip").first().click();
  await page.waitForTimeout(400);
  await applyLook(page, "Cinematic");
  const direct = await previewSignature(page);

  // Start again and put the identical Look on an adjustment layer instead.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addAdjustment(page);
  await applyLook(page, "Cinematic");
  const viaLut = await previewSignature(page);

  // Not byte-identical: a 33-cube interpolates, and the layer composites over
  // the clip rather than being burned into it. Close is the claim — far apart
  // would mean the table is wrong and everyone's grades shifted.
  expect(signatureDistance(direct, viaLut)).toBeLessThan(6);
});
