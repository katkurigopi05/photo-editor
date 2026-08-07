import { expect, test } from "@playwright/test";
import {
  downloadBytes,
  gifFrameMetrics,
  importMedia,
  LUMA_FN,
  previewSignature,
  seekFraction,
  setMode,
  SIGNATURE_FN,
  signatureDistance,
} from "./helpers.js";

/**
 * Export regressions. Each test decodes the file the app actually wrote — none
 * of these bugs were visible from the render path alone.
 */

test("GIF export preserves an opacity fade", async ({ page }) => {
  // GIF stores one bit of alpha, so a fade authored with transform.opacity used
  // to be written at full strength: one black frame, then full brightness.
  await importMedia(page, "photos/gradient-landscape-1600x900.png");
  await setMode(page, "gif");

  const preset = page.locator('select[aria-label="Auto animation preset"]');
  await preset.waitFor();
  await preset.selectOption("fade-in");
  await page
    .locator(".animation-auto-row button", { hasText: "Apply" })
    .first()
    .click();
  await page.waitForTimeout(600);

  const bytes = await downloadBytes(page, "#btn-gif-export");
  const ramp = await gifFrameMetrics(
    page,
    bytes,
    [0, 6, 12, 18, 24, 30],
    LUMA_FN,
  );

  expect(ramp.length).toBeGreaterThan(3);
  // Monotonic and actually travelling, not a step from nothing to everything.
  for (let i = 1; i < ramp.length; i++) {
    expect(ramp[i]!, `frame ${i} of ramp ${ramp.join(" -> ")}`).toBeGreaterThanOrEqual(
      ramp[i - 1]! - 0.5,
    );
  }
  expect(ramp[0]!).toBeLessThan(5);
  expect(ramp[ramp.length - 1]!).toBeGreaterThan(ramp[0]! + 20);
});

test("GIF export preserves transparency", async ({ page }) => {
  // gifenc's alpha options were never passed, so keyed-out pixels took whatever
  // colour sat in that palette slot — a removed background came back black.
  await importMedia(page, "photos/alpha-badge-512x512.png");
  await setMode(page, "gif");

  const bytes = await downloadBytes(page, "#btn-gif-export");
  const transparentFraction = await page.evaluate(
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
      let transparent = 0;
      let total = 0;
      for (let i = 3; i < data.length; i += 4) {
        total++;
        if (data[i] === 0) transparent++;
      }
      return transparent / total;
    },
    { b64: bytes.toString("base64") },
  );

  expect(transparentFraction).toBeGreaterThan(0.05);
});

test("GIF export does not add transparency to an opaque photo", async ({
  page,
}) => {
  // rgba4444 is coarser than rgb565, so only frames that need alpha should pay
  // for it. This is the guard on that choice.
  await importMedia(page, "photos/gradient-landscape-1600x900.png");
  await setMode(page, "gif");

  const bytes = await downloadBytes(page, "#btn-gif-export");
  const transparentFraction = await page.evaluate(
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
      let transparent = 0;
      let total = 0;
      for (let i = 3; i < data.length; i += 4) {
        total++;
        if (data[i] === 0) transparent++;
      }
      return transparent / total;
    },
    { b64: bytes.toString("base64") },
  );

  expect(transparentFraction).toBeLessThan(0.01);
});

test("still export captures the frame at the playhead, not the previous one", async ({
  page,
}) => {
  // Video elements were never in the document, so nothing was composited and no
  // frame was ever presented; currentTime reported the *requested* position, so
  // the export believed it was ready and copied the frame still on screen.
  //
  // Both measurements are of exported files, not of the preview canvas. An
  // earlier version compared the export against preview signatures, which quietly
  // coupled it to the stage's size and aspect: the preview is letterboxed and
  // the export is not, so a layout change moved the numbers and the margin
  // between "right frame" and "stale frame" vanished.
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");

  const exportSignature = async (): Promise<number[]> => {
    const bytes = await downloadBytes(page, "#btn-export");
    return page.evaluate(
      async ({ b64, fn }) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(
          new Blob([bin], { type: "image/png" }),
        );
        return (await eval(fn)(bitmap)) as number[];
      },
      { b64: bytes.toString("base64"), fn: SIGNATURE_FN },
    );
  };

  // Settle early in the clip and export that frame.
  await seekFraction(page, 50);
  await page.waitForTimeout(900);
  await setMode(page, "photo");
  const early = await exportSignature();

  // Jump far and export immediately, with no settle time. A stale export would
  // hand back the frame above.
  await setMode(page, "video");
  await seekFraction(page, 800);
  await setMode(page, "photo");
  const late = await exportSignature();

  const distance = signatureDistance(early, late);
  expect(
    distance,
    `early-vs-late=${distance.toFixed(2)} (a stale export would be near zero)`,
  ).toBeGreaterThan(5);
});

test("MP4 export of a video clip writes distinct frames", async ({ page }) => {
  // GIF and MP4 share seekVideoFrame and neither had ever been exercised
  // against a video clip; a stale seek would repeat one frame throughout.
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");

  await page.evaluate(() => {
    const el = document.getElementById("export-resolution") as HTMLSelectElement;
    el.value = "854x480";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.click("#btn-export");
  await page.waitForTimeout(500);

  const bytes = await downloadBytes(page, "#btn-export-start");
  const signatures = await page.evaluate(
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
      const out: number[][] = [];
      for (const time of [0.2, 1.2, 2.2, 3.2, 4.2]) {
        video.currentTime = time;
        await new Promise((resolve) => {
          video.onseeked = resolve;
        });
        ctx.drawImage(video, 0, 0);
        out.push((await eval(fn)(canvas)) as number[]);
      }
      URL.revokeObjectURL(url);
      return out;
    },
    { b64: bytes.toString("base64"), fn: SIGNATURE_FN },
  );

  for (let i = 1; i < signatures.length; i++) {
    const delta = signatureDistance(signatures[i - 1]!, signatures[i]!);
    expect(delta, `frames ${i - 1}->${i} are the same picture`).toBeGreaterThan(3);
  }
});
