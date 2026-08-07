import { expect, test } from "@playwright/test";

test("a cartoon clip can be added and animated", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Add an animatable Star cartoon clip" }).click();

  await expect(page.locator(".media-name", { hasText: "Star cartoon" })).toBeVisible();
  await expect(page.locator(".clip")).toHaveCount(1);
  await expect(page.locator(".animation-section")).toBeVisible();

  const preset = page.getByLabel("Auto animation preset");
  await preset.selectOption("loop-pulse");
  await page
    .locator(".animation-auto-row")
    .getByRole("button", { name: "Apply" })
    .click();

  await expect(
    page.locator(".animation-control", { hasText: "Scale" }),
  ).toContainText(/[1-9] keyframes?/);
  const paintedPixels = await page.evaluate(() => {
    const canvas = document.getElementById("preview") as HTMLCanvasElement;
    const pixels = canvas
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index]! > 0) painted++;
    }
    return painted;
  });
  expect(paintedPixels).toBeGreaterThan(1000);
});

test("a cartoon clip survives GIF export with its animation", async ({
  page,
}) => {
  // Cartoon clips are generated SVG data URIs rather than imported files, so
  // they take a different route into mediaCache. Everything downstream is the
  // shared drawLayer path — but that is the assumption, and every other
  // "shared path" assumption this week turned out to hide an export bug.
  await page.goto("/", { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Add an animatable Star cartoon clip" })
    .click();
  await expect(page.locator(".clip")).toHaveCount(1);

  const preset = page.getByLabel("Auto animation preset");
  await preset.selectOption("ken-burns-in");
  await page
    .locator(".animation-auto-row")
    .getByRole("button", { name: "Apply" })
    .click();
  await page.waitForTimeout(500);

  await page.evaluate(() => document.getElementById("mode-gif")?.click());
  await page.waitForTimeout(700);

  const download = page.waitForEvent("download", { timeout: 300_000 });
  await page.click("#btn-gif-export");
  const path = await (await download).path();
  const { readFileSync } = await import("node:fs");
  const bytes = readFileSync(path);

  const frames = await page.evaluate(
    async ({ b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const decoder = new ImageDecoder({ data: bin, type: "image/gif" });
      await decoder.tracks.ready;
      await decoder.completed;
      const out: { painted: number; signature: number[] }[] = [];
      for (const index of [0, 20, 40]) {
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
        let painted = 0;
        const signature: number[] = [];
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3]! > 0) painted++;
        }
        // Coarse column profile: enough to tell a scaling star from a static one.
        const cols = 8;
        const colWidth = Math.floor(canvas.width / cols);
        for (let c = 0; c < cols; c++) {
          let lit = 0;
          for (let y = 0; y < canvas.height; y++) {
            for (let x = c * colWidth; x < (c + 1) * colWidth; x++) {
              const i = (y * canvas.width + x) * 4;
              if (data[i]! + data[i + 1]! + data[i + 2]! > 120) lit++;
            }
          }
          signature.push(lit);
        }
        out.push({ painted, signature });
        image.close();
      }
      return out;
    },
    { b64: bytes.toString("base64") },
  );

  expect(frames.length).toBeGreaterThan(1);
  // The shape is actually in the exported file, not a blank frame.
  for (const frame of frames) {
    expect(frame.painted, "exported GIF frame is empty").toBeGreaterThan(1000);
  }
  // Ken Burns scales up, so the shape's footprint must change across the clip.
  const first = frames[0]!.signature.reduce((a, b) => a + b, 0);
  const last = frames[frames.length - 1]!.signature.reduce((a, b) => a + b, 0);
  expect(
    Math.abs(last - first),
    `cartoon animation did not reach the GIF (${first} vs ${last} lit pixels)`,
  ).toBeGreaterThan(500);
});
