import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { importMedia, seekFraction, setMode } from "./helpers.js";

/**
 * Markers.
 *
 * A note is only worth anything if it can be found again, so the checks are
 * about where a marker *is*: visible on the clip, reachable by clicking it, and
 * still attached to the same moment of the picture after the clip has been
 * moved or trimmed — which is the whole reason its time is clip-local rather
 * than a timeline position.
 */

async function addMarkerAt(page: Page, fraction: number): Promise<void> {
  await seekFraction(page, fraction);
  await page.waitForTimeout(400);
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("m");
  await page.waitForTimeout(500);
}

/** Left offset of each marker pin, as a fraction of its clip's width. */
async function pinPositions(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".clip-marker")].map((pin) => {
      const clip = pin.closest(".clip")!.getBoundingClientRect();
      const box = pin.getBoundingClientRect();
      return (box.left + box.width / 2 - clip.left) / clip.width;
    }),
  );
}

test("M drops a marker on the clip at the playhead", async ({ page }) => {
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");
  await page.evaluate(() => {
    const clip = document.querySelector(".clip") as HTMLElement;
    const at = clip.getBoundingClientRect();
    const init = {
      bubbles: true,
      clientX: at.left + at.width / 2,
      clientY: at.top + at.height / 2,
    };
    clip.dispatchEvent(new PointerEvent("pointerdown", init));
    window.dispatchEvent(new PointerEvent("pointerup", init));
  });
  await page.waitForTimeout(400);

  await addMarkerAt(page, 500);
  await expect(page.locator(".clip-marker")).toHaveCount(1);

  const [position] = await pinPositions(page);
  expect(position).toBeGreaterThan(0.35);
  expect(position).toBeLessThan(0.65);

  // It reaches the Inspector too, with the time it was dropped at.
  await expect(page.locator(".marker-row .marker-jump")).toHaveText(
    /00:02\.\d{3}/,
  );

  // And one Undo removes it.
  await page.click("#btn-undo");
  await page.waitForTimeout(500);
  await expect(page.locator(".clip-marker")).toHaveCount(0);
});

test("a marker rides the clip through a trim", async ({ page }) => {
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");
  await page.evaluate(() => {
    const clip = document.querySelector(".clip") as HTMLElement;
    const at = clip.getBoundingClientRect();
    const init = {
      bubbles: true,
      clientX: at.left + at.width / 2,
      clientY: at.top + at.height / 2,
    };
    clip.dispatchEvent(new PointerEvent("pointerdown", init));
    window.dispatchEvent(new PointerEvent("pointerup", init));
  });
  await page.waitForTimeout(400);
  await addMarkerAt(page, 250);

  const before = (await pinPositions(page))[0]!;
  const timeBefore = await page
    .locator(".marker-row .marker-jump")
    .textContent();

  // Trim the tail in: the clip gets shorter, so the marker's *fraction* along
  // it grows while the moment it marks does not move.
  const box = await page.locator(".clip").first().boundingBox();
  await page.mouse.move(box!.x + box!.width - 3, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 120, box!.y + box!.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await page.waitForTimeout(600);

  await expect(page.locator(".clip-marker")).toHaveCount(1);
  const after = (await pinPositions(page))[0]!;
  expect(after).toBeGreaterThan(before);
  // The clip-local time is unchanged — the note still marks the same frame.
  expect(await page.locator(".marker-row .marker-jump").textContent()).toBe(
    timeBefore,
  );
});

test("clicking a pin moves the playhead to it", async ({ page }) => {
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");
  await page.evaluate(() => {
    const clip = document.querySelector(".clip") as HTMLElement;
    const at = clip.getBoundingClientRect();
    const init = {
      bubbles: true,
      clientX: at.left + at.width / 2,
      clientY: at.top + at.height / 2,
    };
    clip.dispatchEvent(new PointerEvent("pointerdown", init));
    window.dispatchEvent(new PointerEvent("pointerup", init));
  });
  await page.waitForTimeout(400);
  await addMarkerAt(page, 700);

  await seekFraction(page, 0);
  await page.waitForTimeout(400);
  await page.locator(".clip-marker").first().click();
  await page.waitForTimeout(500);

  const timecode = await page.locator("#timecode").textContent();
  expect(timecode).toMatch(/00:03\.\d{3}/);
});

test("a to-do marker can be ticked, and the tick undoes", async ({ page }) => {
  await importMedia(page, "video/motion-1280x720-5s.mp4");
  await setMode(page, "video");
  await page.evaluate(() => {
    const clip = document.querySelector(".clip") as HTMLElement;
    const at = clip.getBoundingClientRect();
    const init = {
      bubbles: true,
      clientX: at.left + at.width / 2,
      clientY: at.top + at.height / 2,
    };
    clip.dispatchEvent(new PointerEvent("pointerdown", init));
    window.dispatchEvent(new PointerEvent("pointerup", init));
  });
  await page.waitForTimeout(400);

  await seekFraction(page, 400);
  await page.waitForTimeout(400);
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Shift+M");
  await page.waitForTimeout(600);

  const tick = page.locator('.marker-row input[type="checkbox"]');
  await expect(tick).toHaveCount(1);
  await tick.check();
  await page.waitForTimeout(500);
  await expect(tick).toBeChecked();

  await page.click("#btn-undo");
  await page.waitForTimeout(500);
  await expect(
    page.locator('.marker-row input[type="checkbox"]'),
  ).not.toBeChecked();
});
