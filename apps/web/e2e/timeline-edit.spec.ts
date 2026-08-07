import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { importMedia, MEDIA, setMode } from "./helpers.js";

/**
 * Timeline editing gestures: snapping, trim handles, ripple delete, and
 * multi-select.
 *
 * The arithmetic is unit-tested; what only a browser can show is whether the
 * gestures reach it — whether a trim handle beats the clip's own drag handler
 * to the pointer, whether a ripple's several commands survive the reducer's
 * overlap check in the order they are sent, and whether one Undo puts the
 * whole thing back.
 */

interface ClipBox {
  id: string;
  left: number;
  width: number;
}

/** Geometry of the clips as the timeline actually drew them. */
async function clipBoxes(page: Page): Promise<ClipBox[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".clip")].map((el, index) => {
      const box = (el as HTMLElement).getBoundingClientRect();
      return {
        id:
          (el.querySelector(".clip-label")?.textContent ?? "").trim() ||
          `clip-${index}`,
        left: Math.round(box.left),
        width: Math.round(box.width),
      };
    }),
  );
}

/** Import three photos, which land end to end on the video track. */
async function importThreePhotos(page: Page): Promise<void> {
  await importMedia(page, "photos/colour-chart-512x512.jpg");
  for (const file of [
    "photos/gradient-landscape-1600x900.png",
    "photos/detail-texture-1280x960.jpg",
  ]) {
    await page.setInputFiles("#file-input", MEDIA + file);
    await page.waitForTimeout(600);
  }
  await setMode(page, "video");
  // Three five-second clips are 1800px wide at the default zoom, so the last
  // one sits outside the viewport and a real pointer drag would never reach it.
  await page.evaluate(() => {
    const zoom = document.getElementById("zoom") as HTMLInputElement;
    zoom.value = "40";
    zoom.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(400);
}

/** Press and drag with real pointer events, so handlers see a genuine gesture. */
async function dragBy(
  page: Page,
  from: { x: number; y: number },
  dx: number,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

test("dragging a clip snaps it flush against its neighbour", async ({
  page,
}) => {
  await importThreePhotos(page);
  const before = await clipBoxes(page);
  expect(before.length).toBe(3);
  const flush = before[1]!.left + before[1]!.width;
  const y = await clipY(page);

  // Open a gap first — dragging a clip left onto a neighbour it already abuts
  // is an overlap the reducer refuses, so there would be nothing to snap.
  const third = before[2]!;
  await dragBy(page, { x: third.left + third.width / 2, y }, 60);
  const moved = (await clipBoxes(page))[2]!;
  expect(moved.left).toBeGreaterThan(flush + 40);

  // Now drag back to within a few pixels of flush: the magnet closes the seam.
  await dragBy(
    page,
    { x: moved.left + moved.width / 2, y },
    flush - moved.left + 5,
  );

  const after = await clipBoxes(page);
  expect(after[2]!.left).toBe(flush);
});

test("holding Alt drops a clip exactly where it was released", async ({
  page,
}) => {
  await importThreePhotos(page);
  const before = await clipBoxes(page);
  const flush = before[1]!.left + before[1]!.width;
  const y = await clipY(page);

  const third = before[2]!;
  await dragBy(page, { x: third.left + third.width / 2, y }, 60);
  const moved = (await clipBoxes(page))[2]!;

  // Synthesized rather than driven through page.mouse: macOS Chromium
  // swallows Option-drag before it reaches the page, so a real gesture here
  // would test the platform rather than the snap-override branch.
  await page.evaluate(
    ({ x, y: pointerY, dx }) => {
      const clip = [...document.querySelectorAll(".clip")].at(-1)!;
      const at = (clientX: number): PointerEventInit => ({
        bubbles: true,
        clientX,
        clientY: pointerY,
        altKey: true,
      });
      clip.dispatchEvent(new PointerEvent("pointerdown", at(x)));
      window.dispatchEvent(new PointerEvent("pointermove", at(x + dx)));
      window.dispatchEvent(new PointerEvent("pointerup", at(x + dx)));
    },
    {
      x: moved.left + moved.width / 2,
      y,
      dx: flush - moved.left + 5,
    },
  );
  await page.waitForTimeout(600);

  const after = await clipBoxes(page);
  // Left where it was dropped, five pixels short of the seam, rather than
  // magnetised onto it.
  expect(after[2]!.left).toBeGreaterThan(flush + 2);
  expect(after[2]!.left).toBeLessThan(flush + 10);
});

test("a trim handle shortens the clip instead of moving it", async ({
  page,
}) => {
  await importThreePhotos(page);
  const before = await clipBoxes(page);
  const first = before[0]!;

  // Grab the right edge and pull it left.
  await dragBy(page, { x: first.left + first.width - 3, y: await clipY(page) }, -60);

  const after = await clipBoxes(page);
  expect(after[0]!.left).toBe(first.left);
  expect(after[0]!.width).toBeLessThan(first.width - 40);
});

test("ripple delete closes the gap and one undo restores everything", async ({
  page,
}) => {
  await importThreePhotos(page);
  const before = await clipBoxes(page);
  const second = before[1]!;

  await page.mouse.click(second.left + second.width / 2, await clipY(page));
  await page.waitForTimeout(400);
  await page.click("#btn-ripple-delete");
  await page.waitForTimeout(600);

  const after = await clipBoxes(page);
  expect(after).toHaveLength(2);
  // The third clip moved back into the deleted clip's place.
  expect(after[1]!.left).toBe(before[0]!.left + before[0]!.width);

  // One Undo, not three, even though the ripple issued a delete plus a move.
  await page.click("#btn-undo");
  await page.waitForTimeout(600);
  const restored = await clipBoxes(page);
  expect(restored).toHaveLength(3);
  expect(restored.map((c) => c.left)).toEqual(before.map((c) => c.left));
});

test("shift-click selects several clips and deletes them together", async ({
  page,
}) => {
  await importThreePhotos(page);
  const before = await clipBoxes(page);
  const y = await clipY(page);

  await page.mouse.click(before[0]!.left + before[0]!.width / 2, y);
  await page.waitForTimeout(300);
  await page.keyboard.down("Shift");
  await page.mouse.click(before[1]!.left + before[1]!.width / 2, y);
  await page.keyboard.up("Shift");
  await page.waitForTimeout(300);

  await expect(page.locator(".clip.selected")).toHaveCount(2);

  await page.click("#btn-delete");
  await page.waitForTimeout(600);
  expect(await clipBoxes(page)).toHaveLength(1);

  await page.click("#btn-undo");
  await page.waitForTimeout(600);
  expect(await clipBoxes(page)).toHaveLength(3);
});

/** Vertical centre of the video track lane. */
async function clipY(page: Page): Promise<number> {
  return page.evaluate(() => {
    const clip = document.querySelector(".clip") as HTMLElement;
    const box = clip.getBoundingClientRect();
    return Math.round(box.top + box.height / 2);
  });
}
