import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";

/** Repo-root test media, the same fixtures the unit suite and docs refer to. */
export const MEDIA = fileURLToPath(
  new URL("../../../test_media/", import.meta.url),
);

/**
 * A 32x32 grayscale signature of an image, compared with mean absolute
 * difference.
 *
 * Deliberately not mean luminance: on `motion-1280x720-5s.mp4` the mean varies
 * only 36.06..36.61 across the entire clip, so a test built on it cannot tell
 * one frame from another and passes no matter what the code does. This metric
 * separates frames of that same clip by 8..34, and being downscaled it also
 * survives the resolution difference between a preview canvas and a native
 * export.
 */
export const SIGNATURE_FN = `(async function(src){
  const N=32; const cv=new OffscreenCanvas(N,N);
  const c=cv.getContext("2d",{willReadFrequently:true});
  c.clearRect(0,0,N,N); c.drawImage(src,0,0,N,N);
  const d=c.getImageData(0,0,N,N).data; const out=[];
  for(let i=0;i<d.length;i+=4) out.push(0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]);
  return out;})`;

/** Mean alpha-weighted luminance — the fade signal. */
export const LUMA_FN = `(function(d,w,h){let s=0;const n=w*h;
  for(let i=0;i<n;i++){const o=i*4,a=d[o+3]/255;
    s+=(0.2126*d[o]+0.7152*d[o+1]+0.0722*d[o+2])*a;}
  return s/n;})`;

export function signatureDistance(a: number[], b: number[]): number {
  return a.reduce((total, x, i) => total + Math.abs(x - b[i]!), 0) / a.length;
}

/** Load the app and import one file, waiting for it to reach the timeline. */
export async function importMedia(page: Page, file: string): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.setInputFiles("#file-input", MEDIA + file);
  await page.waitForFunction(
    () => document.querySelectorAll(".clip").length > 0,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(800);
}

/**
 * Switch editor mode. The mode faces are 3D-transformed, so Playwright's
 * actionability check never settles on them — dispatch the click the listener
 * is actually bound to.
 */
export async function setMode(
  page: Page,
  mode: "photo" | "video" | "animation" | "gif",
): Promise<void> {
  await page.evaluate((m) => document.getElementById(`mode-${m}`)?.click(), mode);
  await page.waitForTimeout(700);
}

/** `#seek` is a 0..1000 fraction of the sequence duration, not a timestamp. */
export async function seekFraction(page: Page, value: number): Promise<void> {
  await page.evaluate((v) => {
    const el = document.getElementById("seek") as HTMLInputElement;
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/** Click something that downloads, and hand back the bytes it produced. */
export async function downloadBytes(
  page: Page,
  selector: string,
): Promise<Buffer> {
  const download = page.waitForEvent("download", { timeout: 300_000 });
  await page.click(selector);
  const path = await (await download).path();
  return readFileSync(path);
}

/** Signature of the live preview canvas. */
export async function previewSignature(page: Page): Promise<number[]> {
  return page.evaluate(
    async (fn) => await eval(fn)(document.getElementById("preview")),
    SIGNATURE_FN,
  );
}

/** Decode frames of an exported GIF in the page and measure each one. */
export async function gifFrameMetrics(
  page: Page,
  bytes: Buffer,
  frames: number[],
  metricFn: string,
): Promise<number[]> {
  return page.evaluate(
    async ({ b64, wanted, fn }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const decoder = new ImageDecoder({ data: bin, type: "image/gif" });
      await decoder.tracks.ready;
      await decoder.completed;
      const total = decoder.tracks.selectedTrack!.frameCount;
      const out: number[] = [];
      for (const index of wanted) {
        if (index >= total) break;
        const { image } = await decoder.decode({ frameIndex: index });
        const canvas = new OffscreenCanvas(
          image.displayWidth,
          image.displayHeight,
        );
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        out.push(eval(fn)(pixels.data, canvas.width, canvas.height));
        image.close();
      }
      return out;
    },
    { b64: bytes.toString("base64"), wanted: frames, fn: metricFn },
  );
}

/**
 * A bounding box that is safe to hand to `page.mouse`.
 *
 * `page.mouse` takes **viewport** coordinates. `locator.boundingBox()` returns
 * them too — but only for what is currently on screen, and this app's inspector
 * is long enough that controls routinely sit at y≈2450. Clicking there lands on
 * nothing, and the test fails against a working control.
 *
 * That has now happened twice: once on the curves editor and again on the
 * tracking picker, with the lesson written down in between. Writing it down was
 * not enough, so the fix is a helper that makes the safe thing the easy thing —
 * scroll first, then measure.
 *
 * Use this instead of `boundingBox()` anywhere the result feeds `page.mouse`.
 * For a plain click prefer `locator.click({ position })`, which scrolls on its
 * own; this exists for drags, which need the raw coordinates.
 */
export async function boxInView(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(
      "element has no bounding box — it is not rendered, so no coordinate exists",
    );
  }
  return box;
}

/** A point at a fraction of an element, in viewport coordinates, safe for
 * `page.mouse`. */
export async function pointIn(
  locator: Locator,
  fx = 0.5,
  fy = 0.5,
): Promise<{ x: number; y: number }> {
  const box = await boxInView(locator);
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}
