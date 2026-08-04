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
  await setMode(page, "animation" as "photo");

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
  await setMode(page, "animation" as "photo");

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
