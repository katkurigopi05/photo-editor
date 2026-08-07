import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { downloadBytes, importMedia, MEDIA, setMode } from "./helpers.js";

/**
 * The export dialog's settings, measured in the file they produce.
 *
 * Every one of these was previously fixed — 30fps, three resolutions, three
 * bitrates, always-on 128kbps Opus — so the only honest test is to set them and
 * then decode what the app wrote: dimensions from the video track, duration
 * against the chosen frame rate, and whether an audio track exists at all.
 */

/** Set a select, then let the summary recompute. */
async function choose(page: Page, id: string, value: string): Promise<void> {
  await page.evaluate(
    ({ id: elementId, value: next }) => {
      const select = document.getElementById(elementId) as HTMLSelectElement;
      select.value = next;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { id, value },
  );
  await page.waitForTimeout(300);
}

async function type(page: Page, id: string, value: string): Promise<void> {
  await page.evaluate(
    ({ id: elementId, value: next }) => {
      const input = document.getElementById(elementId) as HTMLInputElement;
      input.value = next;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { id, value },
  );
  await page.waitForTimeout(300);
}

/** Decode the exported MP4's video track. */
async function videoFacts(
  page: Page,
  bytes: Buffer,
): Promise<{ width: number; height: number; duration: number }> {
  return page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bin], { type: "video/mp4" }));
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("exported mp4 failed to load"));
    });
    URL.revokeObjectURL(url);
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    };
  }, bytes.toString("base64"));
}

async function openExport(page: Page): Promise<void> {
  await page.click("#btn-export");
  await page.waitForTimeout(400);
}

test("exports at a chosen resolution and frame rate", async ({ page }) => {
  await importMedia(page, "video/motion-640x360-3s.webm");
  await setMode(page, "video");
  await openExport(page);

  await choose(page, "export-resolution", "custom");
  await type(page, "export-width", "480");
  await type(page, "export-height", "270");
  await choose(page, "export-fps", "24");
  await choose(page, "export-quality", "4000");

  const facts = await videoFacts(
    page,
    await downloadBytes(page, "#btn-export-start"),
  );
  expect(facts.width).toBe(480);
  expect(facts.height).toBe(270);
  // The source is three seconds; the frame rate changes how many frames carry
  // it, not how long it lasts.
  expect(facts.duration).toBeGreaterThan(2.5);
  expect(facts.duration).toBeLessThan(3.6);
});

test("rounds an odd custom size instead of failing the export", async ({
  page,
}) => {
  await importMedia(page, "video/motion-640x360-3s.webm");
  await setMode(page, "video");
  await openExport(page);

  await choose(page, "export-resolution", "custom");
  await type(page, "export-width", "641");
  await type(page, "export-height", "361");

  const facts = await videoFacts(
    page,
    await downloadBytes(page, "#btn-export-start"),
  );
  expect(facts.width).toBe(642);
  expect(facts.height).toBe(362);
});

test("refuses an impossible setting in the dialog, not in the encoder", async ({
  page,
}) => {
  await importMedia(page, "video/motion-640x360-3s.webm");
  await setMode(page, "video");
  await openExport(page);

  await choose(page, "export-quality", "custom");
  await type(page, "export-bitrate", "0");

  await expect(page.locator("#export-summary")).toContainText("bitrate");
  await expect(page.locator("#btn-export-start")).toBeDisabled();

  // And it recovers: a sane value re-enables the button.
  await type(page, "export-bitrate", "6000");
  await expect(page.locator("#btn-export-start")).toBeEnabled();
});

test("the Custom fields appear only when Custom is chosen", async ({ page }) => {
  // Both `.export-field` and `.export-custom` set a display, and the generic
  // `.hidden` has the same specificity — so these panels were on screen at all
  // times until the stylesheet said otherwise. A screenshot caught it; this
  // keeps it caught.
  await importMedia(page, "video/motion-640x360-3s.webm");
  await setMode(page, "video");
  await openExport(page);

  await expect(page.locator("#export-custom-size")).toBeHidden();
  await expect(page.locator("#export-custom-bitrate")).toBeHidden();

  await choose(page, "export-resolution", "custom");
  await expect(page.locator("#export-custom-size")).toBeVisible();
  await choose(page, "export-quality", "custom");
  await expect(page.locator("#export-custom-bitrate")).toBeVisible();

  await choose(page, "export-resolution", "1920x1080");
  await expect(page.locator("#export-custom-size")).toBeHidden();

  // Audio bitrate disappears with audio itself.
  await choose(page, "export-audio-codec", "none");
  await expect(page.locator("#export-audio-bitrate-field")).toBeHidden();
});

test("audio can be switched off, and its bitrate chosen", async ({ page }) => {
  await importMedia(page, "video/motion-640x360-3s.webm");
  await page.setInputFiles("#file-input", MEDIA + "audio/tone-sweep-5s.wav");
  await page.waitForFunction(
    () => document.querySelectorAll(".clip").length > 1,
    { timeout: 30_000 },
  );
  await setMode(page, "video");

  const hasAudio = async (bytes: Buffer): Promise<boolean> =>
    page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const ctx = new AudioContext();
      try {
        const buffer = await ctx.decodeAudioData(bin.buffer);
        let peak = 0;
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          peak = Math.max(peak, Math.abs(data[i]!));
        }
        return peak > 0.001;
      } catch {
        return false;
      } finally {
        await ctx.close();
      }
    }, bytes.toString("base64"));

  await openExport(page);
  await choose(page, "export-audio-codec", "none");
  await expect(page.locator("#export-summary")).toContainText("no audio");
  expect(await hasAudio(await downloadBytes(page, "#btn-export-start"))).toBe(
    false,
  );

  await openExport(page);
  await choose(page, "export-audio-codec", "opus");
  await choose(page, "export-audio-bitrate", "192");
  expect(await hasAudio(await downloadBytes(page, "#btn-export-start"))).toBe(
    true,
  );
});
