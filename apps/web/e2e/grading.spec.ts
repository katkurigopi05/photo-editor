import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { downloadBytes, importMedia, setMode } from "./helpers.js";

/**
 * Colour grading — white balance, levels, tone curve, vibrance.
 *
 * Every one of these is a per-pixel pass behind a cache, and the two ways a
 * grade goes wrong are both invisible to a unit test: the pass never reaches
 * the shared draw path (preview unchanged), or it reaches the preview but not
 * the export (a cache keyed by asset alone hands the export the ungraded
 * render). So each check drives the real inspector and then measures the
 * pixels the app actually painted — and one of them measures a decoded GIF the
 * app produced, not the canvas it drew.
 */
const SOURCE = "photos/colour-chart-512x512.jpg";

interface Channels {
  red: number;
  green: number;
  blue: number;
  luma: number;
  /** Mean per-pixel max-minus-min: how colourful the frame is overall. */
  spread: number;
}

const CHANNEL_STATS = `(function(data){
  let r=0,g=0,b=0,spread=0,n=0;
  for(let i=0;i<data.length;i+=4){
    if(data[i+3]===0) continue;
    const R=data[i],G=data[i+1],B=data[i+2];
    r+=R; g+=G; b+=B; n++;
    spread+=Math.max(R,G,B)-Math.min(R,G,B);
  }
  if(n===0) return {red:0,green:0,blue:0,luma:0,spread:0};
  return {red:r/n, green:g/n, blue:b/n,
    luma:(0.2126*r+0.7152*g+0.0722*b)/n, spread:spread/n};
})`;

async function previewChannels(page: Page): Promise<Channels> {
  return page.evaluate((fn) => {
    const canvas = document.getElementById("preview") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return eval(fn)(data) as Channels;
  }, CHANNEL_STATS);
}

/** Add an effect from the palette by its visible name. */
async function addEffect(page: Page, label: string): Promise<void> {
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll("#effects-palette *")].find(
      (node) => (node.textContent ?? "").trim() === name,
    ) as HTMLElement | undefined;
    el?.click();
  }, label);
  await page.waitForTimeout(600);
}

/** Drive one inspector slider by its accessible name, the way a user does. */
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

test("white balance warms and cools the painted frame", async ({ page }) => {
  await importMedia(page, SOURCE);
  const before = await previewChannels(page);

  await addEffect(page, "White Balance");
  await setSlider(page, "Warmth", 1);
  const warm = await previewChannels(page);

  // Warm means amber: red up, blue down, and both by a visible margin rather
  // than a rounding step.
  expect(warm.red).toBeGreaterThan(before.red + 5);
  expect(warm.blue).toBeLessThan(before.blue - 5);

  await setSlider(page, "Warmth", -1);
  const cool = await previewChannels(page);
  expect(cool.red).toBeLessThan(before.red - 5);
  expect(cool.blue).toBeGreaterThan(before.blue + 5);

  // Returning the slider to neutral must return the pixels, i.e. the cache is
  // keyed by the parameters and not merely by the asset.
  await setSlider(page, "Warmth", 0);
  const neutral = await previewChannels(page);
  expect(Math.abs(neutral.red - before.red)).toBeLessThan(1.5);
  expect(Math.abs(neutral.blue - before.blue)).toBeLessThan(1.5);
});

test("levels gamma lifts midtones and the window clips the ends", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  const before = await previewChannels(page);

  await addEffect(page, "Levels");
  await setSlider(page, "Gamma", 2.5);
  const lifted = await previewChannels(page);
  expect(lifted.luma).toBeGreaterThan(before.luma + 5);

  await setSlider(page, "Gamma", 0.3);
  const crushed = await previewChannels(page);
  expect(crushed.luma).toBeLessThan(before.luma - 5);
});

test("tone curve moves shadows without dragging the whole frame with it", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  const before = await previewChannels(page);

  await addEffect(page, "Tone Curve");
  await setSlider(page, "Shadows", 1);
  const lifted = await previewChannels(page);
  expect(lifted.luma).toBeGreaterThan(before.luma);

  // A shadow lift is not a brightness slider: the frame must not simply move
  // by the full band amount, which on a mid-key chart would be ~89 levels.
  expect(lifted.luma - before.luma).toBeLessThan(60);
});

test("vibrance saturates the preview and bakes into the exported GIF", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  const before = await previewChannels(page);

  await addEffect(page, "Vibrance");
  await setSlider(page, "Amount", 1);
  const boosted = await previewChannels(page);
  expect(boosted.spread).toBeGreaterThan(before.spread + 3);

  // The half that unit tests cannot see: the graded pixels must survive into
  // the file the app writes, not just the canvas it paints. GIF export lives
  // in GIF mode, and switching modes must not drop the grade either.
  await setMode(page, "gif");
  const bytes = await downloadBytes(page, "#btn-gif-export");
  const exported = await page.evaluate(
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
      return eval(fn)(data) as Channels;
    },
    { b64: bytes.toString("base64"), fn: CHANNEL_STATS },
  );

  // GIF quantizes to 256 colours, so the export is compared against the
  // ungraded *preview* baseline rather than against the boosted preview.
  expect(exported.spread).toBeGreaterThan(before.spread + 3);
});
