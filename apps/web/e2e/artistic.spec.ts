import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { downloadBytes, importMedia, setMode } from "./helpers.js";

/**
 * Painterly effects are whole-image pixel passes, cached per (asset, params).
 * A cache keyed wrongly, or a pass that never reaches the export path, both
 * look right in the preview — so each style is measured in a decoded GIF.
 *
 * The source is 512px against a 480px GIF, i.e. almost no resampling. That
 * matters: stylization happens at the media's own resolution and is then
 * scaled to the output, so a 1600px source exported at 480px has most of its
 * brush structure interpolated away. Preview and export stay consistent with
 * each other either way — they scale the same stylized image — but a test at
 * heavy downscale measures the resampler, not the filter.
 */
const SOURCE = "photos/colour-chart-512x512.jpg";

async function addEffect(page: Page, label: string): Promise<void> {
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll("#effects-palette *")].find(
      (node) => (node.textContent ?? "").trim() === name,
    ) as HTMLElement | undefined;
    el?.click();
  }, label);
  await page.waitForTimeout(700);
}

/** Per-pixel statistics of the first frame of an exported GIF. */
async function exportStats(page: Page): Promise<{
  pixels: number[];
  greyFraction: number;
  lumaLevels: number;
  roughness: number;
}> {
  const bytes = await downloadBytes(page, "#btn-gif-export");
  return page.evaluate(
    async ({ b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const decoder = new ImageDecoder({ data: bin, type: "image/gif" });
      await decoder.tracks.ready;
      await decoder.completed;
      const { image } = await decoder.decode({ frameIndex: 0 });
      const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      // Downsample to a fixed grid so two exports are comparable even if the
      // encoder chose different dimensions.
      const grid = 32;
      const pixels: number[] = [];
      for (let gy = 0; gy < grid; gy++) {
        for (let gx = 0; gx < grid; gx++) {
          const x = Math.floor((gx / grid) * canvas.width);
          const y = Math.floor((gy / grid) * canvas.height);
          const i = (y * canvas.width + x) * 4;
          pixels.push(data[i]!, data[i + 1]!, data[i + 2]!);
        }
      }
      let grey = 0;
      let total = 0;
      let roughness = 0;
      let pairs = 0;
      const levels = new Set<number>();
      const lumaAt = (i: number): number =>
        0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x + 1 < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          if (data[i + 3] === 0 || data[i + 7] === 0) continue;
          roughness += Math.abs(lumaAt(i) - lumaAt(i + 4));
          pairs++;
        }
      }
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        total++;
        const spread =
          Math.max(data[i]!, data[i + 1]!, data[i + 2]!) -
          Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
        if (spread <= 24) grey++;
        levels.add(
          Math.round(0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!),
        );
      }
      return {
        pixels,
        greyFraction: total === 0 ? 0 : grey / total,
        lumaLevels: levels.size,
        roughness: pairs === 0 ? 0 : roughness / pairs,
      };
    },
    { b64: bytes.toString("base64") },
  );
}

const meanDelta = (a: number[], b: number[]): number =>
  a.reduce((total, v, i) => total + Math.abs(v - b[i]!), 0) / a.length;

test("each painterly style reaches the exported GIF", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "gif");
  const plain = await exportStats(page);

  // Oil Painting is excluded here and tested on its own below: Kuwahara
  // deliberately leaves flat blocks and hard edges alone, which is all this
  // colour chart contains, so "did the picture change" is the wrong question
  // to ask of it.
  for (const style of [
    "Pencil Sketch",
    "Cartoon",
    "Watercolour",
    "Crosshatch",
    "Halftone",
  ]) {
    await importMedia(page, SOURCE);
    await setMode(page, "photo");
    await addEffect(page, style);
    await setMode(page, "gif");
    const styled = await exportStats(page);

    // The bug this guards: an effect that renders in the preview and never
    // reaches the encoder would come back byte-identical to the plain export.
    expect(
      meanDelta(plain.pixels, styled.pixels),
      `${style} did not change the exported picture`,
    ).toBeGreaterThan(8);
  }
});

test("Pencil Sketch exports as grey graphite, not colour", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "gif");
  const plain = await exportStats(page);

  await importMedia(page, SOURCE);
  await setMode(page, "photo");
  await addEffect(page, "Pencil Sketch");
  await setMode(page, "gif");
  const sketched = await exportStats(page);

  // A colour chart drawn in pencil has no colour left in it.
  expect(sketched.greyFraction).toBeGreaterThan(0.9);
  expect(plain.greyFraction).toBeLessThan(0.5);
});

test("Cartoon reduces the number of tones in the export", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "gif");
  const plain = await exportStats(page);

  await importMedia(page, SOURCE);
  await setMode(page, "photo");
  await addEffect(page, "Cartoon");
  await setMode(page, "gif");
  const flattened = await exportStats(page);

  // Posterizing to bands cannot add tones, and the resampler only blurs the
  // band edges rather than restoring the originals.
  expect(
    flattened.lumaLevels,
    `tones did not reduce: ${plain.lumaLevels} -> ${flattened.lumaLevels}`,
  ).toBeLessThan(plain.lumaLevels);
});

test("Oil Painting smooths within regions rather than across edges", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await setMode(page, "gif");
  const plain = await exportStats(page);

  await importMedia(page, SOURCE);
  await setMode(page, "photo");
  await addEffect(page, "Oil Painting");
  await setMode(page, "gif");
  const painted = await exportStats(page);

  // Kuwahara takes the mean of the lowest-variance quadrant, so neighbouring
  // pixels inside a region converge while edges keep their step. Local
  // roughness therefore falls — the opposite of what sharpening would do, and
  // distinguishable from a blur only by the edges surviving, which the unit
  // tests pin directly.
  expect(
    painted.roughness,
    `roughness did not fall: ${plain.roughness.toFixed(2)} -> ${painted.roughness.toFixed(2)}`,
  ).toBeLessThan(plain.roughness);
});
