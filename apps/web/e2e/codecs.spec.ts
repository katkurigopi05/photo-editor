import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { downloadBytes, importMedia, setMode } from "./helpers.js";

/**
 * More than one video codec.
 *
 * The export schema always described the full matrix — it mirrors the Rust
 * crate — while the browser path hardcoded H.264 into MP4. Which codecs a
 * browser will really encode is not a fact about the schema: it varies by
 * operating system, by build and by whether a hardware encoder is present. So
 * it is probed and whatever comes back is offered.
 *
 * The check that matters is not that a codec appears in a dropdown but that
 * choosing it produces a file the browser can decode again.
 */

async function openExport(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.getElementById(
      "export-resolution",
    ) as HTMLSelectElement;
    el.value = "854x480";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.click("#btn-export");
  // The probe runs on open and fills the picker.
  await page.waitForTimeout(1200);
}

test("the codec picker offers what this browser actually encodes", async ({
  page,
}) => {
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");
  await openExport(page);

  const options = await page.evaluate(() =>
    [...document.querySelectorAll("#export-codec option")].map((o) => ({
      value: (o as HTMLOptionElement).value,
      disabled: (o as HTMLOptionElement).disabled,
      label: (o as HTMLOptionElement).textContent ?? "",
    })),
  );

  // All three are listed whatever the answer: "not offered here" and "does not
  // exist" are different messages, and only the first is true.
  expect(options.map((o) => o.value).sort()).toEqual(["av1", "h264", "vp9"]);
  // H.264 is the one every build encodes; if it were missing, export would be
  // broken rather than merely limited.
  expect(options.find((o) => o.value === "h264")?.disabled).toBe(false);
  // An unavailable codec is disabled and says so, rather than being hidden.
  for (const option of options) {
    if (option.disabled) expect(option.label).toContain("unavailable here");
  }
});

test("a WebM export decodes back to moving pictures", async ({ page }) => {
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");
  await openExport(page);

  const canVp9 = await page.evaluate(() => {
    const el = document.getElementById("export-codec") as HTMLSelectElement;
    const option = [...el.options].find((o) => o.value === "vp9");
    return option !== undefined && !option.disabled;
  });
  test.skip(!canVp9, "this browser will not encode VP9 at this size");

  await page.evaluate(() => {
    const el = document.getElementById("export-codec") as HTMLSelectElement;
    el.value = "vp9";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(400);

  const bytes = await downloadBytes(page, "#btn-export-start");
  expect(bytes.length).toBeGreaterThan(1000);

  // EBML magic. A VP9 stream written into an MP4 container would still be
  // bytes, and would still be unplayable — this proves the container followed
  // the codec.
  expect([...bytes.slice(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);

  const distinct = await page.evaluate(async (b64: string) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bin], { type: "video/webm" }));
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("exported webm failed to load"));
    });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const seen: string[] = [];
    for (const time of [0.2, 2.2, 4.2]) {
      video.currentTime = time;
      await new Promise((resolve) => {
        video.onseeked = resolve;
      });
      ctx.drawImage(video, 0, 0);
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4 * 97) sum += d[i]!;
      seen.push(String(sum));
    }
    URL.revokeObjectURL(url);
    return new Set(seen).size;
  }, Buffer.from(bytes).toString("base64"));

  // Three different frames, not one repeated: a stale seek would give one.
  expect(distinct).toBeGreaterThan(1);
});

test("H.264 still writes an MP4, unchanged", async ({ page }) => {
  // The default path must not have moved while the others were added.
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");
  await openExport(page);

  const bytes = await downloadBytes(page, "#btn-export-start");
  // 'ftyp' at offset 4 is the ISO base media signature.
  expect(String.fromCharCode(...bytes.slice(4, 8))).toBe("ftyp");
});
