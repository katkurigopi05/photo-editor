import { expect, test, type Page } from "@playwright/test";
import { downloadBytes, importMedia, setMode } from "./helpers.js";

/**
 * A caption is only useful if it reaches the exported file. Text is drawn in
 * drawOverlays, the same place vignette and border live, so it inherits the
 * shared preview/GIF/MP4 path — but that inheritance is exactly the assumption
 * that hid four export bugs, so it gets checked rather than assumed.
 */
async function addTextEffect(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("#effects-palette *")].find(
      (node) => (node.textContent ?? "").trim() === "Text",
    ) as HTMLElement | undefined;
    el?.click();
  });
  await page.waitForTimeout(400);
}

test("a caption renders in the preview and survives GIF export", async ({
  page,
}) => {
  await importMedia(page, "photos/gradient-landscape-1600x900.png");
  await addTextEffect(page);

  const caption = page.locator(".control-text textarea");
  await expect(caption).toBeVisible();
  await caption.fill("HELLO WORLD");
  await caption.dispatchEvent("change");
  await page.waitForTimeout(600);

  // The caption is white with a black outline; count near-white pixels as a
  // proxy for "glyphs were painted".
  const brightPixels = async (): Promise<number> =>
    page.evaluate(() => {
      const canvas = document.getElementById("preview") as HTMLCanvasElement;
      const data = canvas
        .getContext("2d", { willReadFrequently: true })!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let bright = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! > 240 && data[i + 1]! > 240 && data[i + 2]! > 240) bright++;
      }
      return bright;
    });

  const withText = await brightPixels();
  expect(withText, "caption not visible in the preview").toBeGreaterThan(200);

  await setMode(page, "gif");
  const bytes = await downloadBytes(page, "#btn-gif-export");
  const inExport = await page.evaluate(
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
      let bright = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! > 235 && data[i + 1]! > 235 && data[i + 2]! > 235) bright++;
      }
      return bright;
    },
    { b64: bytes.toString("base64") },
  );

  expect(inExport, "caption missing from the exported GIF").toBeGreaterThan(100);
});

test("an empty caption paints nothing", async ({ page }) => {
  // A blank text effect must not draw an outline box or shift the frame.
  await importMedia(page, "photos/gradient-landscape-1600x900.png");
  const before = await page.evaluate(() => {
    const canvas = document.getElementById("preview") as HTMLCanvasElement;
    const data = canvas
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i]!;
    return sum;
  });

  await addTextEffect(page);
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => {
    const canvas = document.getElementById("preview") as HTMLCanvasElement;
    const data = canvas
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i]!;
    return sum;
  });

  expect(after).toBe(before);
});
