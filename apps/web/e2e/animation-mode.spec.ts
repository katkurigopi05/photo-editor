import { expect, test } from "@playwright/test";
import { downloadBytes, setMode } from "./helpers.js";

/**
 * Animation is the fourth editor mode: build motion from generated clips
 * rather than imported footage. It keeps the timeline and transport, because
 * that is where keyframes are placed, but drops the raster pixel tools, which
 * do not apply to a vector shape.
 */

test("animation mode is reachable and keeps the timeline", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await setMode(page, "animation");

  await expect(page.locator("#mode-animation")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // The transport is what photo mode hides; animation must not.
  await expect(page.locator("#seek")).toBeVisible();
  await expect(page.locator("#btn-next")).toBeVisible();
  // Pixel tools do not apply to generated shapes.
  await expect(page.locator(".raster-rail")).toBeHidden();
  await expect(page.locator("#stage-empty")).toContainText("cartoon clip");
});

test("a cartoon animated in animation mode exports as a GIF", async ({
  page,
}) => {
  // The whole point of the mode: no imported media at any stage.
  await page.goto("/", { waitUntil: "networkidle" });
  await setMode(page, "animation");

  await page
    .getByRole("button", { name: "Add an animatable Circle cartoon clip" })
    .click();
  await expect(page.locator(".clip")).toHaveCount(1);

  const preset = page.getByLabel("Auto animation preset");
  await preset.selectOption("pan-right");
  await page
    .locator(".animation-auto-row")
    .getByRole("button", { name: "Apply" })
    .click();
  await page.waitForTimeout(500);

  await setMode(page, "gif");
  const bytes = await downloadBytes(page, "#btn-gif-export");

  const centroids = await page.evaluate(
    async ({ b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const decoder = new ImageDecoder({ data: bin, type: "image/gif" });
      await decoder.tracks.ready;
      await decoder.completed;
      const out: number[] = [];
      for (const index of [0, 25]) {
        if (index >= decoder.tracks.selectedTrack!.frameCount) break;
        const { image } = await decoder.decode({ frameIndex: index });
        const canvas = new OffscreenCanvas(
          image.displayWidth,
          image.displayHeight,
        );
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let sumX = 0;
        let weight = 0;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            // The circle is purple on a transparent field; weight by how far
            // the pixel is from the background rather than by luminance.
            const w = data[i + 3]!;
            if (w === 0) continue;
            sumX += x * w;
            weight += w;
          }
        }
        out.push(weight === 0 ? -1 : sumX / weight / canvas.width);
        image.close();
      }
      return out;
    },
    { b64: bytes.toString("base64") },
  );

  expect(centroids.length).toBe(2);
  expect(centroids[0], "nothing was painted in the GIF").toBeGreaterThan(0);
  // pan-right moves the shape across the frame; the centroid has to follow.
  expect(
    centroids[1]! - centroids[0]!,
    `centroid did not travel: ${centroids.join(" -> ")}`,
  ).toBeGreaterThan(0.02);
});

test("a chosen fill colour reaches the exported cartoon", async ({ page }) => {
  // Shapes used to be locked to one hue each. The picker overrides the
  // preset's colour for the next clip added.
  await page.goto("/", { waitUntil: "networkidle" });
  await setMode(page, "animation");

  await page.evaluate(() => {
    const input = document.getElementById("vector-fill") as HTMLInputElement;
    input.value = "#ff0000";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page
    .getByRole("button", { name: "Add an animatable Heart cartoon clip" })
    .click();
  await expect(page.locator(".clip")).toHaveCount(1);

  await setMode(page, "gif");
  const bytes = await downloadBytes(page, "#btn-gif-export");
  const redFraction = await page.evaluate(
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
      let red = 0;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        total++;
        if (data[i]! > 180 && data[i + 1]! < 80 && data[i + 2]! < 80) red++;
      }
      return red / total;
    },
    { b64: bytes.toString("base64") },
  );

  // The heart is pink by default; a red export means the override was used.
  expect(redFraction, "chosen fill did not reach the export").toBeGreaterThan(
    0.02,
  );
});

test("an animation exports to MP4 without leaving animation mode", async ({
  page,
}) => {
  // The GIF test above switches to GIF mode before exporting, so it proves
  // nothing about MP4 being reachable from Animation mode itself. This one
  // never leaves the mode: shape, motion and video export all happen in it.
  await page.goto("/", { waitUntil: "networkidle" });
  await setMode(page, "animation");

  await page
    .getByRole("button", { name: "Add an animatable Star cartoon clip" })
    .click();
  await expect(page.locator(".clip")).toHaveCount(1);

  const preset = page.getByLabel("Auto animation preset");
  await preset.selectOption("pan-right");
  await page
    .locator(".animation-auto-row")
    .getByRole("button", { name: "Apply" })
    .click();
  await page.waitForTimeout(500);

  await expect(page.locator("#mode-animation")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await page.click("#btn-export");
  const bytes = await downloadBytes(page, "#btn-export-start");
  expect(bytes.length, "MP4 export produced no bytes").toBeGreaterThan(1000);

  // MP4 carries no alpha, so the shape sits on black. Weight the centroid by
  // luminance rather than alpha, and report coverage so an empty frame is
  // distinguishable from a stationary one.
  const measured = await page.evaluate(
    async ({ b64 }) => {
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

      const out: { cx: number; lit: number }[] = [];
      for (const time of [0.1, video.duration * 0.8]) {
        video.currentTime = time;
        await new Promise((resolve) => {
          video.onseeked = resolve;
        });
        ctx.drawImage(video, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let sumX = 0;
        let weight = 0;
        let lit = 0;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            const luma =
              0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
            if (luma < 24) continue;
            sumX += x * luma;
            weight += luma;
            lit++;
          }
        }
        out.push({
          cx: weight === 0 ? -1 : sumX / weight / canvas.width,
          lit: lit / (canvas.width * canvas.height),
        });
      }
      URL.revokeObjectURL(url);
      return { out, width: canvas.width, height: canvas.height };
    },
    { b64: bytes.toString("base64") },
  );

  const [first, last] = measured.out;
  expect(measured.width, "exported MP4 has no dimensions").toBeGreaterThan(0);
  expect(
    first!.lit,
    `nothing was painted into the MP4: ${JSON.stringify(measured)}`,
  ).toBeGreaterThan(0.001);
  // pan-right: the star has to be further right at the end than at the start.
  expect(
    last!.cx - first!.cx,
    `star did not travel in the MP4: ${JSON.stringify(measured.out)}`,
  ).toBeGreaterThan(0.02);
});
