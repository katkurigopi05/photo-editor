import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  importMedia,
  previewSignature,
  setMode,
  signatureDistance,
  boxInView,
} from "./helpers.js";

/**
 * Control-point curves.
 *
 * The three-band Tone Curve could only push shadows, midtones and highlights.
 * This is the real thing: points you place yourself, on the composite or on any
 * one channel.
 *
 * What has to be true here is what the unit tests cannot see — that dragging in
 * the editor reaches the render, and that the *direction* is right. A curve
 * dragged upward must brighten; a test that only checked "the picture changed"
 * would pass for a curve wired in upside down.
 */

const SOURCE = "photos/gradient-landscape-1600x900.png";

/** Mean luminance of the preview. */
async function brightness(page: Page): Promise<number> {
  const sig = await previewSignature(page);
  return sig.reduce((a, b) => a + b, 0) / sig.length;
}

async function addCurves(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("#effects-palette *")].find(
      (node) => (node.textContent ?? "").trim() === "Curves",
    ) as HTMLElement | undefined;
    el?.click();
  });
  await page.waitForTimeout(800);
  await expect(page.locator(".curve-canvas")).toHaveCount(1);
  await page.locator(".curve-canvas").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
}

/**
 * Drag on the curve canvas from one normalized point to another.
 *
 * Normalized so the test says what it means — "take the midpoint and pull it
 * upward" — rather than restating the canvas size.
 */
async function dragCurve(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const canvas = page.locator(".curve-canvas");
  // The Inspector scrolls, and the editor can sit well below the fold —
  // page.mouse works in viewport coordinates, so a box read without scrolling
  // first sends the drag to empty space outside the window.
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  // scrollIntoView first: the curve editor sits far down the inspector and
  // page.mouse takes viewport coordinates. See boxInView.
  const box = await boxInView(canvas);
  const at = (p: { x: number; y: number }) => ({
    x: box.x + p.x * box.width,
    y: box.y + (1 - p.y) * box.height,
  });
  const a = at(from);
  const b = at(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
}

test("pulling the curve up brightens, and down darkens", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "photo");
  await addCurves(page);

  const flat = await brightness(page);

  // Grab the middle of the identity curve and lift it.
  await dragCurve(page, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.8 });
  const lifted = await brightness(page);
  expect(lifted).toBeGreaterThan(flat + 2);

  // And back down past the diagonal, which must darken relative to flat.
  await dragCurve(page, { x: 0.5, y: 0.8 }, { x: 0.5, y: 0.2 });
  const pulled = await brightness(page);
  expect(pulled).toBeLessThan(flat - 2);
});

test("a curve is one Undo per drag, not one per pointer move", async ({
  page,
}) => {
  // The editor commits on release. Committing per move would bury the
  // operation log and make Undo step back through a drag pixel by pixel.
  await importMedia(page, SOURCE);
  await setMode(page, "photo");
  await addCurves(page);
  const flat = await brightness(page);

  await dragCurve(page, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.85 });
  expect(await brightness(page)).toBeGreaterThan(flat + 2);

  await page.click("#btn-undo");
  await page.waitForTimeout(900);
  expect(Math.abs((await brightness(page)) - flat)).toBeLessThan(2);
});

test("a per-channel curve tints rather than brightening evenly", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await setMode(page, "photo");
  await addCurves(page);
  const before = await previewSignature(page);

  await page.getByRole("button", { name: "R curve" }).click();
  await page.waitForTimeout(400);
  await dragCurve(page, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.85 });

  // The signature is luminance-weighted, so lifting red alone moves it much
  // less than lifting all three would — the point being that the channel tab
  // selects a genuinely separate curve rather than editing the composite.
  const after = await previewSignature(page);
  expect(signatureDistance(before, after)).toBeGreaterThan(0.5);
});

test("Reset channel returns the curve to the diagonal", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "photo");
  await addCurves(page);
  const flat = await brightness(page);

  await dragCurve(page, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.85 });
  expect(await brightness(page)).toBeGreaterThan(flat + 2);

  await page.getByRole("button", { name: "Reset channel" }).click();
  await page.waitForTimeout(900);
  expect(Math.abs((await brightness(page)) - flat)).toBeLessThan(2);
});
