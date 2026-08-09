import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { importMedia, setMode } from "./helpers.js";

/**
 * Audio meters and video scopes.
 *
 * Both are read-only instruments, which makes them easy to ship broken: a meter
 * wired to nothing sits at silence, and a scope drawing from a stale buffer
 * looks perfectly plausible. So every check here moves the *signal* and asserts
 * the instrument moved with it — a scope that never changes fails, however
 * pretty it looks.
 */

/** How much of a canvas is lit, 0..1. */
async function inkFraction(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const canvas = document.querySelector(sel) as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]! / 255;
      if ((data[i]! + data[i + 1]! + data[i + 2]!) * alpha > 150) lit++;
    }
    return lit / (data.length / 4);
  }, selector);
}

/** A copy of the meter's pixels, to compare a later reading against. */
async function meterPixels(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector("#audio-meter") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    return [...ctx.getImageData(0, 0, canvas.width, canvas.height).data];
  });
}

/**
 * How much of the meter changed since `baseline`, 0..1.
 *
 * Counting lit pixels does not work here and the reason is worth keeping: the
 * meter's empty track is drawn in the theme's line colour, which is opaque, so
 * a brightness threshold reads the same number whether the signal is at full
 * scale or silent — the assertion would pass against a meter wired to nothing.
 * What a working meter does is *change*, so that is what gets measured.
 */
function changedFraction(baseline: number[], current: number[]): number {
  let changed = 0;
  for (let i = 0; i < current.length; i += 4) {
    const delta =
      Math.abs(current[i]! - baseline[i]!) +
      Math.abs(current[i + 1]! - baseline[i + 1]!) +
      Math.abs(current[i + 2]! - baseline[i + 2]!) +
      Math.abs(current[i + 3]! - baseline[i + 3]!);
    if (delta > 40) changed++;
  }
  return changed / (current.length / 4);
}

/** Mean horizontal position of lit pixels, 0..1 — where the trace sits. */
async function inkCentroidX(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const canvas = document.querySelector(sel) as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const { data, width } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let weight = 0;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const value = data[i]! + data[i + 1]! + data[i + 2]!;
      if (value <= 150) continue;
      const x = (i / 4) % width;
      sum += x;
      weight++;
    }
    return weight === 0 ? 0 : sum / weight / width;
  }, selector);
}

test("scopes stay off until asked, then measure the picture", async ({
  page,
}) => {
  await importMedia(page, "photos/colour-chart-512x512.jpg");

  // Off by default: they cost a readback of every displayed frame.
  await expect(page.locator("#scope-canvas")).toBeHidden();
  await expect(page.locator("#scope-readout")).toHaveText("");

  await page.selectOption("#scope-kind", "histogram");
  await page.waitForTimeout(600);
  await expect(page.locator("#scope-canvas")).toBeVisible();
  // The readout is the numeric half of the instrument; empty means it drew
  // without measuring.
  await expect(page.locator("#scope-readout")).not.toHaveText("");
  expect(await inkFraction(page, "#scope-canvas")).toBeGreaterThan(0.02);
});

test("the histogram follows the exposure it is measuring", async ({ page }) => {
  await importMedia(page, "photos/colour-chart-512x512.jpg");
  await page.selectOption("#scope-kind", "histogram");
  await page.waitForTimeout(600);

  const before = await inkCentroidX(page, "#scope-canvas");

  // Brightening moves levels up, so the trace must move right. This is the
  // assertion that separates a live scope from a decorative one.
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("#effects-palette *")].find(
      (node) => (node.textContent ?? "").trim() === "Brightness",
    ) as HTMLElement | undefined;
    el?.click();
  });
  await page.waitForTimeout(600);
  const slider = page.locator('input[type="range"][aria-label="Amount"]');
  await slider.evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = input.max;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(800);

  const after = await inkCentroidX(page, "#scope-canvas");
  expect(after).toBeGreaterThan(before + 0.02);
});

/** The saturation the vectorscope reports, as a percentage. */
async function reportedSaturation(page: Page): Promise<number> {
  const text = (await page.locator("#scope-readout").textContent()) ?? "";
  const match = /sat ([\d.]+)%/.exec(text);
  expect(match, `readout was "${text}"`).not.toBeNull();
  return Number(match![1]);
}

test("the vectorscope collapses to the centre on a black-and-white look", async ({
  page,
}) => {
  await importMedia(page, "photos/colour-chart-512x512.jpg");
  await page.selectOption("#scope-kind", "vectorscope");
  await page.waitForTimeout(600);

  // The reported number rather than the painted spread: when the trace
  // collapses, the pixels still lit are the graticule, which sits at a *large*
  // radius — measuring the drawing made desaturation look like the opposite.
  const colourSaturation = await reportedSaturation(page);
  expect(colourSaturation).toBeGreaterThan(10);

  // A desaturated picture has no hue to plot, so every sample lands on the
  // centre point. Saturation is the one thing a vectorscope cannot fake.
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".look-chip")].find(
      (node) => (node.textContent ?? "").trim() === "B&W",
    ) as HTMLElement;
    chip.click();
  });
  await page.waitForTimeout(900);

  // Filter-based effects are drawn into the canvas rather than set on the
  // element, so what the scope reads is what the user sees. That was worth
  // checking rather than assuming: the opposite would have meant a scope
  // reporting the colour of a picture that is on screen in grey.
  expect(await reportedSaturation(page)).toBeLessThan(colourSaturation / 3);
});

test("the audio meter reads the signal being played", async ({ page }) => {
  await importMedia(page, "audio/tone-sweep-5s.wav");
  await setMode(page, "video");

  const silent = await meterPixels(page);

  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Space");
  await page.waitForTimeout(1800);
  const playing = await meterPixels(page);
  await page.keyboard.press("Space");

  // A meter wired to nothing sits exactly where it started; this is the check
  // that it is reading the graph rather than decorating the transport.
  expect(changedFraction(silent, playing)).toBeGreaterThan(0.05);
});

test("the meter falls back after the transport stops", async ({ page }) => {
  await importMedia(page, "audio/tone-sweep-5s.wav");
  await setMode(page, "video");

  const silent = await meterPixels(page);
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Space");
  await page.waitForTimeout(1500);
  const playing = await meterPixels(page);
  await page.keyboard.press("Space");

  // The hold marker falls a fixed amount per frame, so a stopped transport
  // must empty the meter rather than freeze it at the last reading.
  await page.waitForTimeout(2500);
  const stopped = await meterPixels(page);
  expect(changedFraction(silent, playing)).toBeGreaterThan(0.05);
  expect(changedFraction(silent, stopped)).toBeLessThan(
    changedFraction(silent, playing) / 2,
  );
});
