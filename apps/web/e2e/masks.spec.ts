import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { downloadBytes, importMedia, setMode } from "./helpers.js";

/**
 * Local adjustments: a mask confining an effect to part of the frame.
 *
 * The unit tests prove the geometry and the blend. What only the running app
 * can show is that a mask authored in the inspector reaches the renderer, that
 * it lands in the right *part* of the frame rather than merely somewhere, and
 * that the region survives into the exported file at a different resolution —
 * which is the whole reason masks are stored as normalized geometry.
 */
const SOURCE = "photos/gradient-landscape-1600x900.png";

/** Mean luminance of a rectangle given as fractions of the canvas. */
const REGION_FN = `(function(data, w, h, x0, y0, x1, y1){
  const left=Math.floor(x0*w), right=Math.floor(x1*w);
  const top=Math.floor(y0*h), bottom=Math.floor(y1*h);
  let sum=0, n=0;
  for(let y=top;y<bottom;y++){
    for(let x=left;x<right;x++){
      const i=(y*w+x)*4;
      if(data[i+3]===0) continue;
      sum+=0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2]; n++;
    }
  }
  return n===0?0:sum/n;
})`;

async function previewRegion(
  page: Page,
  box: [number, number, number, number],
): Promise<number> {
  return page.evaluate(
    ({ fn, box: b }) => {
      const canvas = document.getElementById("preview") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return eval(fn)(
        data,
        canvas.width,
        canvas.height,
        b[0],
        b[1],
        b[2],
        b[3],
      ) as number;
    },
    { fn: REGION_FN, box },
  );
}

async function addEffect(page: Page, label: string): Promise<void> {
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll("#effects-palette *")].find(
      (node) => (node.textContent ?? "").trim() === name,
    ) as HTMLElement | undefined;
    el?.click();
  }, label);
  await page.waitForTimeout(600);
}

async function addMask(page: Page, label: string): Promise<void> {
  await page.evaluate((name) => {
    const select = document.querySelector(
      'select[aria-label="Add mask"]',
    ) as HTMLSelectElement;
    select.value = name;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, label);
  await page.waitForTimeout(600);
}

async function setSlider(
  page: Page,
  label: string,
  value: number,
): Promise<void> {
  const slider = page.locator(`input[type="range"][aria-label="${label}"]`);
  await expect(slider).toBeVisible();
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await page.waitForTimeout(600);
}

/** Attach the clip's only mask to the effect whose type is `effectType`. */
async function attachMask(page: Page, effectType: string): Promise<void> {
  await page.evaluate((type) => {
    const select = document.querySelector(
      `select[aria-label="${type} mask"]`,
    ) as HTMLSelectElement;
    select.selectedIndex = 1; // "Whole frame" is index 0
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, effectType);
  await page.waitForTimeout(700);
}

test("a masked effect changes only the region the mask covers", async ({
  page,
}) => {
  await importMedia(page, SOURCE);

  // A brightness lift, then a radial mask pinned to the left third.
  await addEffect(page, "Exposure");
  await setSlider(page, "Stops", 1.5);
  await addMask(page, "Radial");
  await setSlider(page, "Centre across", 0.2);
  await setSlider(page, "Width", 0.15);
  await setSlider(page, "Feather", 0);

  const left = () => previewRegion(page, [0.12, 0.4, 0.28, 0.6]);
  const right = () => previewRegion(page, [0.72, 0.4, 0.88, 0.6]);
  const brightLeft = await left();
  const brightRight = await right();

  await attachMask(page, "color.exposure");
  const maskedLeft = await left();
  const maskedRight = await right();

  // Inside the mask the lift survives; outside it the frame drops back.
  expect(Math.abs(maskedLeft - brightLeft)).toBeLessThan(
    Math.abs(maskedRight - brightRight),
  );
  expect(maskedRight).toBeLessThan(brightRight - 5);
  expect(maskedLeft).toBeGreaterThan(maskedRight);
});

test("the region survives export at a different resolution", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await addEffect(page, "Exposure");
  await setSlider(page, "Stops", 1.5);
  await addMask(page, "Radial");
  await setSlider(page, "Centre across", 0.2);
  await setSlider(page, "Width", 0.15);
  await setSlider(page, "Feather", 0);
  await attachMask(page, "color.exposure");

  await setMode(page, "gif");
  const masked = await exportedRegions(page);

  // Detach the mask and export again. Comparing the same regions across the
  // two exports is the only honest test: this source's own brightness varies
  // left to right, so "inside is brighter than outside" would be true of the
  // unmasked frame too.
  await setMode(page, "photo");
  await page.evaluate(() => {
    const select = document.querySelector(
      'select[aria-label="color.exposure mask"]',
    ) as HTMLSelectElement;
    select.selectedIndex = 0;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(600);
  await setMode(page, "gif");
  const global = await exportedRegions(page);

  // Inside the mask both exports agree; outside it, only the unmasked export
  // carries the lift.
  expect(Math.abs(masked.inside - global.inside)).toBeLessThan(
    Math.abs(masked.outside - global.outside),
  );
  expect(masked.outside).toBeLessThan(global.outside - 3);
});

/** Export a GIF and measure the two regions in its first frame. */
async function exportedRegions(
  page: Page,
): Promise<{ inside: number; outside: number; width: number }> {
  const bytes = await downloadBytes(page, "#btn-gif-export");
  return page.evaluate(
    async ({ b64, fn }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const decoder = new ImageDecoder({ data: bin, type: "image/gif" });
      await decoder.tracks.ready;
      await decoder.completed;
      const { image } = await decoder.decode({ frameIndex: 0 });
      const canvas = new OffscreenCanvas(
        image.displayWidth,
        image.displayHeight,
      );
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      image.close();
      const region = (
        x0: number,
        y0: number,
        x1: number,
        y1: number,
      ): number =>
        eval(fn)(data, canvas.width, canvas.height, x0, y0, x1, y1) as number;
      return {
        inside: region(0.12, 0.4, 0.28, 0.6),
        outside: region(0.72, 0.4, 0.88, 0.6),
        width: canvas.width,
      };
    },
    { b64: bytes.toString("base64"), fn: REGION_FN },
  );
}

test("removing a mask in use is refused, and detaching it first works", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await addEffect(page, "Exposure");
  await addMask(page, "Radial");
  await attachMask(page, "color.exposure");

  await page.evaluate(() => {
    const remove = [...document.querySelectorAll("#inspector button")].find(
      (node) => (node.textContent ?? "").trim() === "Remove",
    ) as HTMLElement | undefined;
    // The Masks section's Remove, not the effect's: find it by its title.
    const masked = [...document.querySelectorAll("#inspector button")].find(
      (node) => (node as HTMLButtonElement).title.startsWith("Delete this mask"),
    ) as HTMLElement | undefined;
    (masked ?? remove)?.click();
  });
  await page.waitForTimeout(500);

  // Still there: the command engine refused to strand the reference.
  await expect(page.locator('select[aria-label="Add mask"]')).toBeVisible();
  await expect(
    page.locator('select[aria-label="color.exposure mask"]'),
  ).toBeVisible();

  // Detach, then the same click removes it.
  await page.evaluate(() => {
    const select = document.querySelector(
      'select[aria-label="color.exposure mask"]',
    ) as HTMLSelectElement;
    select.selectedIndex = 0;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const masked = [...document.querySelectorAll("#inspector button")].find(
      (node) => (node as HTMLButtonElement).title.startsWith("Delete this mask"),
    ) as HTMLElement | undefined;
    masked?.click();
  });
  await page.waitForTimeout(500);

  await expect(
    page.locator('select[aria-label="color.exposure mask"]'),
  ).toHaveCount(0);
});
