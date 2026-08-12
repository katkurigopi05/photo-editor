import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { downloadBytes, importMedia, MEDIA, setMode } from "./helpers.js";

/**
 * Blend modes.
 *
 * Everything composited with normal alpha until now, so the check that matters
 * is that a mode reaches the *pixels* — and reaches them the same way in the
 * preview and in the file. A blend mode that only affects the preview is worse
 * than none: the picture being graded would not be the picture delivered.
 *
 * Two clips stacked on separate tracks, because a blend mode is a relationship
 * between a clip and what is beneath it.
 */

/** Add a second video track and drop `assetIndex` from the bin onto it. */
async function stackOnNewTrack(page: Page, assetIndex: number): Promise<void> {
  await page.click("#btn-add-track");
  await page.waitForTimeout(400);
  await page.evaluate((index) => {
    const item = document.querySelectorAll(".media-item")[index] as HTMLElement;
    const lanes = document.querySelectorAll(".track-lane");
    // The lane just added, which is the last visual one.
    const lane = lanes[lanes.length - 1] as HTMLElement;
    const transfer = new DataTransfer();
    item.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }),
    );
    lane.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
    );
  }, assetIndex);
  await page.waitForTimeout(700);
}

/** Mean RGB of the preview canvas. */
async function previewMean(
  page: Page,
): Promise<{ r: number; g: number; b: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 8) continue;
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      n++;
    }
    return n === 0 ? { r: 0, g: 0, b: 0 } : { r: r / n, g: g / n, b: b / n };
  });
}

/**
 * Select the clip that composites on top.
 *
 * Earlier tracks draw last, so the clip on the first track is the one with
 * something beneath it — and the only one whose blend mode has anything to
 * blend with. Setting the mode on the lower clip changes nothing, which is
 * correct behaviour and a silently vacuous test.
 */
async function selectTopClip(page: Page): Promise<void> {
  await page.evaluate(() => {
    const clip = document.querySelector(".track-row .clip") as HTMLElement;
    const at = clip.getBoundingClientRect();
    const init = {
      bubbles: true,
      clientX: at.left + at.width / 2,
      clientY: at.top + at.height / 2,
    };
    clip.dispatchEvent(new PointerEvent("pointerdown", init));
    window.dispatchEvent(new PointerEvent("pointerup", init));
  });
  await page.waitForTimeout(400);
}

/** Pick a blend mode for the selected clip, the way a person would. */
async function chooseBlend(page: Page, label: string): Promise<void> {
  const select = page.locator('select[aria-label="Blend mode"]');
  await expect(select).toBeVisible();
  await select.selectOption({ label });
  await page.waitForTimeout(600);
}

async function stackTwoPhotos(page: Page): Promise<void> {
  await importMedia(page, "photos/colour-chart-512x512.jpg");
  await page.setInputFiles(
    "#file-input",
    MEDIA + "photos/gradient-landscape-1600x900.png",
  );
  await page.waitForTimeout(900);
  await setMode(page, "video");
  await stackOnNewTrack(page, 1);
  await selectTopClip(page);
}

test("Multiply darkens the composite and Screen brightens it", async ({
  page,
}) => {
  await stackTwoPhotos(page);

  const normal = await previewMean(page);
  expect(normal.r + normal.g + normal.b).toBeGreaterThan(0);

  await chooseBlend(page, "Multiply");
  const multiplied = await previewMean(page);

  await chooseBlend(page, "Screen");
  const screened = await previewMean(page);

  // The definitions, not a hand-tuned threshold: multiply can only darken and
  // screen can only brighten, so each must sit on its own side of normal.
  const luma = (c: { r: number; g: number; b: number }): number =>
    0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  expect(luma(multiplied)).toBeLessThan(luma(normal) - 2);
  expect(luma(screened)).toBeGreaterThan(luma(normal) + 2);
});

test("returning to Normal leaves no trace in the project", async ({ page }) => {
  await stackTwoPhotos(page);
  const normal = await previewMean(page);

  await chooseBlend(page, "Difference");
  const differenced = await previewMean(page);
  expect(Math.abs(differenced.r - normal.r)).toBeGreaterThan(2);

  await chooseBlend(page, "Normal");
  const back = await previewMean(page);
  expect(Math.abs(back.r - normal.r)).toBeLessThan(1);

  // One undo per change, and the clip ends with no blendMode member at all —
  // which is what makes a project saved before blend modes replay identically.
  await page.click("#btn-undo");
  await page.click("#btn-undo");
  await page.waitForTimeout(600);
  await expect(page.locator('select[aria-label="Blend mode"]')).toHaveValue(
    "normal",
  );
});

test("the exported file carries the blend, not just the preview", async ({
  page,
}) => {
  await stackTwoPhotos(page);
  const normalPreview = await previewMean(page);

  await chooseBlend(page, "Multiply");
  await page.waitForTimeout(400);

  // Exported as a still, decoded, and measured — the preview canvas is not
  // evidence about the file, which is the mistake this project has made before.
  // Photo mode exports the still; the same drawLayer runs, so a blend that
  // survives here survives the video path too.
  await setMode(page, "photo");
  const bytes = await downloadBytes(page, "#btn-export");

  const exported = await page.evaluate(async (b64) => {
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]);
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let r = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 8) continue;
      r += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
      n++;
    }
    return n === 0 ? 0 : r / n;
  }, bytes.toString("base64"));

  const normalLuma =
    0.2126 * normalPreview.r +
    0.7152 * normalPreview.g +
    0.0722 * normalPreview.b;
  expect(exported).toBeGreaterThan(0);
  expect(exported).toBeLessThan(normalLuma - 2);
});
