import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { importMedia, setMode } from "./helpers.js";

/**
 * Spill suppression in the raster editor.
 *
 * The arithmetic is unit-tested. What only this can check is that the tool is
 * reachable, that pressing Apply changes the picture on the canvas, and that the
 * raster session's own Undo takes it back — the suppression runs outside the
 * command engine, so it has its own undo stack and nothing else tests that path
 * for this tool.
 *
 * The fixture carries real spill: green mixed back into the subject near its
 * silhouette, strongest at the edge. A subject merely pasted onto green would
 * have none, and every assertion here would pass on a tool that did nothing.
 */

const SOURCE = "photos/green-screen-900x1200.png";

/** Measure the raster canvas: mean colour, and how much of it reads green. */
async function canvasReading(
  page: Page,
): Promise<{ green: number; excess: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector(
      "#raster-canvas, canvas.raster-canvas, #preview",
    ) as HTMLCanvasElement;
    const off = document.createElement("canvas");
    off.width = canvas.width;
    off.height = canvas.height;
    const context = off.getContext("2d")!;
    context.drawImage(canvas, 0, 0);
    const { data } = context.getImageData(0, 0, off.width, off.height);
    let green = 0;
    let excess = 0;
    let counted = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 8) continue;
      const limit = (data[i]! + data[i + 2]!) / 2;
      green += data[i + 1]!;
      if (data[i + 1]! > limit + 8) excess += 1;
      counted += 1;
    }
    return { green: green / counted, excess: excess / counted };
  });
}

async function openSpillTool(page: Page): Promise<void> {
  await importMedia(page, SOURCE);
  // Selected in video mode, then switched: photo mode hides the timeline, so
  // `.clip` is in the DOM with no bounding box and a click on it waits forever.
  // But "Edit Photo" only appears in photo mode, so both steps are needed and
  // in this order.
  await setMode(page, "video");
  await page.locator(".clip").first().click();
  await page.waitForTimeout(400);
  await setMode(page, "photo");
  await page.getByRole("button", { name: /Edit Photo/ }).click();
  await page.waitForTimeout(800);
  await page.locator('.raster-tool-btn[title="Spill Suppression"]').click();
  await page.waitForTimeout(400);
}

test("the tool is in the raster rail and reports what it measures", async ({
  page,
}) => {
  await openSpillTool(page);
  // The reading is the reason to trust the panel: it names a number taken from
  // this photo, so a panel that opened on the wrong image is visible.
  await expect(page.locator(".raster-hint").last()).toContainText(
    /carry a green cast|No measurable spill/,
  );
});

test("applying it removes the green cast from the picture", async ({ page }) => {
  await openSpillTool(page);
  const before = await canvasReading(page);
  expect(before.excess).toBeGreaterThan(0.2);

  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForTimeout(900);

  const after = await canvasReading(page);
  // The screen itself is the bulk of the frame and is pure green, so the
  // fraction carrying an excess must fall a long way.
  expect(after.excess).toBeLessThan(before.excess - 0.3);
  expect(after.green).toBeLessThan(before.green);
});

test("the raster Undo takes the suppression back", async ({ page }) => {
  // Raster edits sit outside the command engine and keep their own history.
  await openSpillTool(page);
  const before = await canvasReading(page);

  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForTimeout(900);
  expect((await canvasReading(page)).excess).toBeLessThan(before.excess - 0.3);

  // The raster session has its own Undo, distinct from the global #btn-undo —
  // scoped to the raster panel so this cannot silently test the wrong one.
  await page.locator(".raster-toolbar button", { hasText: "Undo" }).click();
  await page.waitForTimeout(900);

  const back = await canvasReading(page);
  expect(Math.abs(back.excess - before.excess)).toBeLessThan(0.02);
  expect(Math.abs(back.green - before.green)).toBeLessThan(2);
});

test("Amount at zero leaves the picture alone", async ({ page }) => {
  // Proves Apply is reading the slider rather than always suppressing fully —
  // a control wired to nothing looks identical to one that works, until this.
  await openSpillTool(page);
  const before = await canvasReading(page);

  // `sliderControl` commits on "change", not "input" — "input" only updates the
  // number beside the label. Dispatching the wrong one leaves the option at its
  // default and this test passes against a slider wired to nothing.
  await page.evaluate(() => {
    const slider = document.querySelector<HTMLInputElement>(
      'input[type=range][aria-label="Amount"]',
    )!;
    slider.value = "0";
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForTimeout(900);

  const after = await canvasReading(page);
  expect(Math.abs(after.green - before.green)).toBeLessThan(1);
});
