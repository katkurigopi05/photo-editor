import { expect, test } from "@playwright/test";
import { downloadBytes, MEDIA, setMode } from "./helpers.js";

/**
 * Turning a still photograph into motion: import a real image, animate it, and
 * export video. This is the Ken Burns case — the oldest trick for giving a
 * still picture life — and it is what "can I make an animated video from a
 * photo" actually means.
 *
 * Animation mode advertises cartoon clips in its empty state, so the first
 * thing worth proving is that an imported photograph is equally welcome there.
 */

/**
 * Width of the drawn picture's bounding box, and how much of the frame it fills.
 *
 * A square photo in a 16:9 frame is pillarboxed, so zooming in widens the box
 * until it reaches the frame edge. That is a directional signal — "the picture
 * got bigger" — which mean luminance and plain frame-difference cannot give.
 *
 * Deliberately measured over the whole frame rather than a single row. The
 * colour chart's gutter is (24,26,32), luma 25.6, and its centre row lands
 * exactly on a gutter line: a row-wise probe reads that as empty and reports no
 * picture at all.
 */
const EXTENT_FN = `(function(data, w, h){
  let lit = 0, minX = 1e9, maxX = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = 0.2126*data[i] + 0.7152*data[i+1] + 0.0722*data[i+2];
      if (l <= 30) continue;
      lit++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  return { width: maxX - minX, lit: lit / (w * h) };
})`;

test("a real photograph becomes an animated MP4 via Ken Burns", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await setMode(page, "animation");

  // A photograph, not a generated shape.
  await page.setInputFiles(
    "#file-input",
    MEDIA + "photos/colour-chart-1024x1024.png",
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".clip").length > 0,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(600);

  const preset = page.getByLabel("Auto animation preset");
  await preset.selectOption("ken-burns-in");
  await page
    .locator(".animation-auto-row")
    .getByRole("button", { name: "Apply" })
    .click();
  await page.waitForTimeout(500);

  // Still in animation mode, with an imported photo on the timeline.
  await expect(page.locator("#mode-animation")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await page.click("#btn-export");
  const bytes = await downloadBytes(page, "#btn-export-start");
  expect(bytes.length, "MP4 export produced no bytes").toBeGreaterThan(1000);

  const extents = await page.evaluate(
    async ({ b64, fn }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bin], { type: "video/mp4" }));
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error("exported mp4 failed to load"));
      });
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

      const out: { width: number; lit: number }[] = [];
      for (const time of [0.1, video.duration * 0.5, video.duration * 0.85]) {
        video.currentTime = time;
        await new Promise((resolve) => {
          video.onseeked = resolve;
        });
        ctx.drawImage(video, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        out.push(eval(fn)(data, canvas.width, canvas.height));
      }
      URL.revokeObjectURL(url);
      return out;
    },
    { b64: bytes.toString("base64"), fn: EXTENT_FN },
  );

  const shown = JSON.stringify(extents);
  const [first, mid, last] = extents;
  expect(first!.lit, `the photograph never reached the MP4: ${shown}`).toBeGreaterThan(0.05);
  // Ken Burns In zooms toward the frame, so the picture has to keep growing.
  expect(mid!.width, `picture did not grow by mid-clip: ${shown}`).toBeGreaterThan(first!.width);
  expect(last!.width, `picture did not keep growing: ${shown}`).toBeGreaterThan(mid!.width);
  expect(last!.lit, `frame coverage did not increase: ${shown}`).toBeGreaterThan(first!.lit);
});
