import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { downloadBytes, importMedia, MEDIA, setMode } from "./helpers.js";

/**
 * Audio fades, EQ and compression.
 *
 * The mixdown runs in an `OfflineAudioContext` that only exists in a browser,
 * and the fade a user hears while monitoring is computed by a different code
 * path from the fade that is written into the file. So the test that matters is
 * this one: drive the real inspector, export, and decode the audio the app
 * produced.
 */

async function addAudioEffect(page: Page, label: string): Promise<void> {
  await page.evaluate((name) => {
    const select = document.querySelector(
      'select[aria-label="Add audio effect…"]',
    ) as HTMLSelectElement;
    const option = [...select.options].find((o) => o.text === name)!;
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, label);
  await page.waitForTimeout(500);
}

async function setSlider(
  page: Page,
  label: string,
  value: number,
): Promise<void> {
  const slider = page.locator(`input[type="range"][aria-label="${label}"]`);
  await expect(slider).toBeVisible();
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await page.waitForTimeout(400);
}

/** Import a video (so the export has frames) plus an audio clip. */
async function importVideoAndAudio(page: Page): Promise<void> {
  await importMedia(page, "video/motion-640x360-3s.webm");
  await page.setInputFiles("#file-input", MEDIA + "audio/tone-sweep-5s.wav");
  await page.waitForFunction(
    () => document.querySelectorAll(".clip").length > 1,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(600);
}

/**
 * Select the audio clip on the timeline — the one whose lane is the audio
 * track, i.e. the last clip added.
 *
 * The clip's pointerdown handler starts a drag, so the matching pointerup has
 * to be dispatched too: leaving the drag open lets the next interaction commit
 * a clip move, which silently shifts the timeline under the test.
 */
async function selectAudioClip(page: Page): Promise<void> {
  await page.evaluate(() => {
    const clips = [...document.querySelectorAll(".clip")] as HTMLElement[];
    const clip = clips[clips.length - 1];
    const at = clip?.getBoundingClientRect();
    if (!clip || !at) return;
    const position = {
      bubbles: true,
      clientX: at.left + at.width / 2,
      clientY: at.top + at.height / 2,
    };
    clip.dispatchEvent(new PointerEvent("pointerdown", position));
    window.dispatchEvent(new PointerEvent("pointerup", position));
  });
  await page.waitForTimeout(500);
}

test("an audio clip exposes fade, EQ and compressor controls", async ({
  page,
}) => {
  await importVideoAndAudio(page);
  await setMode(page, "video");
  await selectAudioClip(page);

  await addAudioEffect(page, "Fade In / Out");
  await setSlider(page, "Fade in (s)", 2);

  await addAudioEffect(page, "EQ");
  await setSlider(page, "Low (dB)", 6);

  await addAudioEffect(page, "Compressor");
  await setSlider(page, "Ratio", 8);

  // Each change went through the command engine rather than mutating state.
  const history = await page.locator("#history-list").innerText();
  expect(history).toContain("timeline.add_effect");
  expect(history).toContain("timeline.update_effect_params");

  // And they survive a re-render as real project state.
  await expect(
    page.locator('input[type="range"][aria-label="Fade in (s)"]'),
  ).toHaveValue("2");
  await expect(
    page.locator('input[type="range"][aria-label="Ratio"]'),
  ).toHaveValue("8");
});

test("a fade in is audible in the exported mixdown", async ({ page }) => {
  await importVideoAndAudio(page);
  await setMode(page, "video");
  await selectAudioClip(page);

  await addAudioEffect(page, "Fade In / Out");
  await setSlider(page, "Fade in (s)", 2);

  await page.click("#btn-export");
  await page.waitForTimeout(500);
  const bytes = await downloadBytes(page, "#btn-export-start");

  // Decode the file the app wrote and compare the first half-second against a
  // window after the ramp has finished. A fade that only existed in the
  // monitor — the bug this guards — leaves these equal.
  const levels = await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(bin.buffer);
    const data = buffer.getChannelData(0);
    const rms = (fromSec: number, toSec: number): number => {
      const from = Math.floor(fromSec * buffer.sampleRate);
      const to = Math.min(
        Math.floor(toSec * buffer.sampleRate),
        buffer.length,
      );
      let sum = 0;
      for (let i = from; i < to; i++) sum += data[i]! * data[i]!;
      return Math.sqrt(sum / Math.max(1, to - from));
    };
    await ctx.close();
    return { head: rms(0, 0.4), afterRamp: rms(2.2, 2.8) };
  }, bytes.toString("base64"));

  expect(levels.afterRamp).toBeGreaterThan(0.01);
  expect(levels.head).toBeLessThan(levels.afterRamp * 0.5);
});
