import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { downloadBytes, importMedia, setMode } from "./helpers.js";

/**
 * The Lightroom panels: Tone (Light), Colour Mixer, Colour Grading, Presence
 * and Noise Reduction.
 *
 * The adjustment functions arrived as pure raster code with unit tests and no
 * route into the app at all — no effect types, no controls, nothing reaching a
 * pixel a user can see. These checks are specifically about that gap: each
 * control is driven through the real inspector, and the painted canvas is
 * measured.
 */
const SOURCE = "photos/colour-chart-512x512.jpg";

interface Stats {
  red: number;
  green: number;
  blue: number;
  luma: number;
  /** Mean per-pixel max-minus-min: how colourful the frame is. */
  spread: number;
  /** Mean absolute difference between horizontal neighbours. */
  detail: number;
}

const STATS_FN = `(function(data, w, h){
  let r=0,g=0,b=0,spread=0,n=0,detail=0,pairs=0;
  for(let i=0;i<data.length;i+=4){
    if(data[i+3]===0) continue;
    const R=data[i],G=data[i+1],B=data[i+2];
    r+=R; g+=G; b+=B; n++;
    spread+=Math.max(R,G,B)-Math.min(R,G,B);
  }
  for(let y=0;y<h;y++){
    for(let x=0;x+1<w;x++){
      const i=(y*w+x)*4;
      detail+=Math.abs(data[i]-data[i+4]); pairs++;
    }
  }
  if(n===0) return {red:0,green:0,blue:0,luma:0,spread:0,detail:0};
  return {red:r/n, green:g/n, blue:b/n,
    luma:(0.2126*r+0.7152*g+0.0722*b)/n, spread:spread/n,
    detail:detail/Math.max(1,pairs)};
})`;

async function previewStats(page: Page): Promise<Stats> {
  return page.evaluate((fn) => {
    const canvas = document.getElementById("preview") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return eval(fn)(data, canvas.width, canvas.height) as Stats;
  }, STATS_FN);
}

async function addEffect(page: Page, label: string): Promise<void> {
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll("#effects-palette *")].find(
      (node) => (node.textContent ?? "").trim() === name,
    ) as HTMLElement | undefined;
    el?.click();
  }, label);
  await page.waitForTimeout(700);
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
  await page.waitForTimeout(700);
}

test("Tone lifts shadows and pulls highlights independently", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  const before = await previewStats(page);

  await addEffect(page, "Tone (Light)");
  await setSlider(page, "Shadows", 100);
  const lifted = await previewStats(page);
  expect(lifted.luma).toBeGreaterThan(before.luma + 2);

  await setSlider(page, "Shadows", 0);
  await setSlider(page, "Highlights", -100);
  const pulled = await previewStats(page);
  expect(pulled.luma).toBeLessThan(before.luma - 2);
});

test("the Colour Mixer moves one band and leaves the others", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  const before = await previewStats(page);

  await addEffect(page, "Colour Mixer (HSL)");
  // Default band is red; drop its saturation to the floor.
  await setSlider(page, "Saturation", -100);
  const redKilled = await previewStats(page);
  expect(redKilled.spread).toBeLessThan(before.spread);

  // Switching the band to one the chart also contains must be a *different*
  // result, not the same edit relabelled.
  await page.evaluate(() => {
    const select = document.querySelector(
      'select[aria-label="Colour Mixer (HSL) Band"]',
    ) as HTMLSelectElement;
    select.value = "blue";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(700);
  const blueKilled = await previewStats(page);
  expect(Math.abs(blueKilled.blue - redKilled.blue)).toBeGreaterThan(0.5);
});

test("Colour Grading tints shadows and highlights differently", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  const before = await previewStats(page);

  await addEffect(page, "Colour Grading");
  await setSlider(page, "Shadow hue", 220); // blue
  await setSlider(page, "Shadow strength", 100);
  const shadowsGraded = await previewStats(page);
  expect(shadowsGraded.blue).toBeGreaterThan(before.blue + 1);

  await setSlider(page, "Shadow strength", 0);
  await setSlider(page, "Highlight hue", 40); // amber
  await setSlider(page, "Highlight strength", 100);
  const highlightsGraded = await previewStats(page);
  expect(highlightsGraded.red).toBeGreaterThan(before.red + 1);
});

test("Presence adds and removes local detail", async ({ page }) => {
  await importMedia(page, SOURCE);
  const before = await previewStats(page);

  await addEffect(page, "Presence");
  await setSlider(page, "Texture", 100);
  const sharpened = await previewStats(page);
  expect(sharpened.detail).toBeGreaterThan(before.detail);

  await setSlider(page, "Texture", -100);
  const softened = await previewStats(page);
  expect(softened.detail).toBeLessThan(before.detail);
});

/** Decode the first frame of a GIF the app exported and measure it. */
async function exportedStats(page: Page): Promise<Stats> {
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
      return eval(fn)(data, canvas.width, canvas.height) as Stats;
    },
    { b64: bytes.toString("base64"), fn: STATS_FN },
  );
}

test("Noise Reduction smooths the exported frame", async ({ page }) => {
  // Measured in the exported file rather than in the preview. An adjusted clip
  // is drawn from an offscreen canvas and then rescaled into the preview, and
  // that rescale changes neighbour differences by more than the smoothing does
  // — so a preview-based assertion would be measuring the resampler. The
  // export renders at native size, where the smoothing is the only variable.
  await importMedia(page, "photos/detail-texture-1280x960.jpg");
  await addEffect(page, "Noise Reduction");
  await setMode(page, "gif");

  const before = await exportedStats(page);
  expect(before.detail).toBeGreaterThan(0.2); // the frame really did render

  await setSlider(page, "Luminance", 100);
  const smoothed = await exportedStats(page);
  // A modest margin on purpose: GIF quantizes to 256 colours, and the dither
  // that produces has a neighbour-difference floor of its own that no amount
  // of smoothing upstream removes. Measured 0.716 -> 0.667 on this fixture.
  expect(smoothed.detail).toBeLessThan(before.detail * 0.97);
});
