import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { downloadBytes, importMedia, setMode } from "./helpers.js";

/**
 * Proxy media.
 *
 * A proxy is only worth having if it is genuinely what editing reads *and*
 * genuinely not what export reads. Both halves are checked here: the preview
 * against a 540p copy of a 720p source, and the exported file against the
 * original — measured on the file itself rather than trusted.
 */

/** Wait for the badge the media item shows once a proxy is in use. */
async function waitForProxy(page: Page): Promise<void> {
  await expect(page.locator(".media-badge")).toHaveText(/Proxy \d+p/, {
    timeout: 180_000,
  });
}

test("a 720p import is edited against a 540p proxy", async ({ page }) => {
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");
  await waitForProxy(page);

  // The badge reports the proxy's real decoded height, not an intention.
  const height = await page
    .locator(".media-item")
    .first()
    .getAttribute("data-proxy-height");
  expect(Number(height)).toBe(540);

  // And the proxy is a file on disk, keyed by checksum, so it survives a
  // reload rather than being rebuilt.
  const stored = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("proxies");
    const names: string[] = [];
    for await (const entry of (
      dir as unknown as { values: () => AsyncIterable<FileSystemHandle> }
    ).values()) {
      names.push(entry.name);
    }
    return names;
  });
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatch(/^[0-9a-f]{64}\.mp4$/);
});

test("the preview still paints while proxies are on", async ({ page }) => {
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");
  await waitForProxy(page);
  await page.waitForTimeout(800);

  // Reading the proxy is only useful if it reaches the canvas: a silently
  // missing element renders black, which is exactly what this catches.
  const ink = await page.evaluate(() => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! + data[i + 1]! + data[i + 2]! > 60) lit++;
    }
    return lit / (data.length / 4);
  });
  expect(ink).toBeGreaterThan(0.2);
});

test("switching proxies off goes back to the original", async ({ page }) => {
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");
  await waitForProxy(page);

  await page.uncheck("#proxy-enabled");
  await page.waitForTimeout(600);
  // The proxy is still built — the badge stays — but its title says it is not
  // being used, and the setting survives a reload.
  await expect(page.locator(".media-badge")).toHaveAttribute(
    "title",
    /switched off/,
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  expect(await page.isChecked("#proxy-enabled")).toBe(false);
});

test("Clear deletes the proxy files", async ({ page }) => {
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");
  await waitForProxy(page);

  await page.click("#btn-clear-proxies");
  await page.waitForTimeout(1000);
  await expect(page.locator(".media-badge")).toHaveCount(0);

  const left = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    try {
      const dir = await root.getDirectoryHandle("proxies");
      let count = 0;
      for await (const _entry of (
        dir as unknown as { values: () => AsyncIterable<FileSystemHandle> }
      ).values()) {
        count++;
      }
      return count;
    } catch {
      return 0;
    }
  });
  expect(left).toBe(0);
});

/**
 * Mean edge energy of one frame, decoded at a fixed size.
 *
 * Sharpness is the thing that separates an export made from the original from
 * one made from a 540p proxy, and edge energy is the cheapest honest measure of
 * it: upscaling a proxy back to 720p cannot put back detail it never had.
 */
const FRAME_DETAIL = `
  async (input) => {
    const url = input.url ?? URL.createObjectURL(
      new Blob([Uint8Array.from(atob(input.b64), (c) => c.charCodeAt(0))], {
        type: "video/mp4",
      }),
    );
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("could not decode"));
    });
    await new Promise((resolve) => {
      video.onseeked = resolve;
      video.currentTime = input.time;
    });
    const canvas = document.createElement("canvas");
    canvas.width = input.width;
    canvas.height = input.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let total = 0;
    const stride = canvas.width * 4;
    for (let y = 1; y < canvas.height - 1; y++) {
      for (let x = 1; x < canvas.width - 1; x++) {
        const i = y * stride + x * 4;
        const luma = (j) => 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
        total += Math.abs(luma(i) - luma(i + 4)) + Math.abs(luma(i) - luma(i + stride));
      }
    }
    return total / ((canvas.width - 2) * (canvas.height - 2));
  }
`;

/** Set a control in the export dialog the way a person would. */
async function setField(
  page: Page,
  id: string,
  value: string,
): Promise<void> {
  await page.evaluate(
    ({ id: elementId, value: next }) => {
      const field = document.getElementById(elementId) as
        | HTMLSelectElement
        | HTMLInputElement;
      field.value = next;
      field.dispatchEvent(
        new Event(field instanceof HTMLSelectElement ? "change" : "input", {
          bubbles: true,
        }),
      );
    },
    { id, value },
  );
  await page.waitForTimeout(250);
}

test("export reads the original, not the proxy", async ({ page }) => {
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");
  await waitForProxy(page);

  // Exported at the source's own size and a generous bitrate, and measured at
  // that size: any rescale or heavy compression in the way would blunt the one
  // difference this test exists to see.
  const exportDetail = async (): Promise<number> => {
    await page.click("#btn-export");
    await page.waitForTimeout(400);
    await setField(page, "export-resolution", "custom");
    await setField(page, "export-width", "1280");
    await setField(page, "export-height", "720");
    await setField(page, "export-quality", "20000");
    const bytes = await downloadBytes(page, "#btn-export-start");
    return page.evaluate(
      ([fn, b64]) =>
        (eval(fn) as (input: unknown) => Promise<number>)({
          b64,
          time: 2,
          width: 1280,
          height: 720,
        }),
      [FRAME_DETAIL, bytes.toString("base64")] as const,
    );
  };

  const withProxies = await exportDetail();
  await page.uncheck("#proxy-enabled");
  await page.waitForTimeout(500);
  const withoutProxies = await exportDetail();

  expect(withProxies).toBeGreaterThan(0);
  expect(Math.abs(withProxies - withoutProxies) / withoutProxies).toBeLessThan(
    0.05,
  );
});
