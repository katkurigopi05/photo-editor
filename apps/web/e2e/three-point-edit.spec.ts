import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { importMedia, seekFraction, setMode } from "./helpers.js";

/**
 * Three-point editing through the real toolbar.
 *
 * The browser range chooses source in and out; the playhead chooses the
 * destination; the mode decides what happens to what is already there. What has
 * to be true at this level is what the unit tests cannot see: that the toolbar
 * actually reaches the two new commands, that the timeline the person is
 * looking at rearranges, and that one gesture is one undo.
 */

const SOURCE = "video/motion-1280x720-5s.mp4";

/** Start and duration of every clip on the timeline, in microseconds. */
async function clips(page: Page): Promise<Array<[number, number]>> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".clip")].map(
      (clip) =>
        [
          Number((clip as HTMLElement).dataset.startUs ?? "-1"),
          Number((clip as HTMLElement).dataset.durationUs ?? "0"),
        ] as [number, number],
    ),
  );
}

async function setEditMode(
  page: Page,
  mode: "append" | "insert" | "overwrite",
): Promise<void> {
  await page.getByLabel("Add mode").selectOption(mode);
}

/** Choose a source range in the bin, so the added clip is a known length. */
async function chooseRange(
  page: Page,
  inUs: number,
  outUs: number,
): Promise<void> {
  await page.locator(".media-range-btn").first().click();
  await page.waitForTimeout(300);
  for (const [label, value] of [
    ["In", inUs],
    ["Out", outUs],
  ] as const) {
    await page
      .locator(`input[type="range"][aria-label^="${label}"]`)
      .evaluate((el, v) => {
        const input = el as HTMLInputElement;
        input.value = String(v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    await page.waitForTimeout(150);
  }
  await page.getByRole("button", { name: "Use range" }).click();
  await page.waitForTimeout(400);
}

test("append puts the clip after the last one, as it always did", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await chooseRange(page, 0, 1_000_000);

  await setEditMode(page, "append");
  await page.locator(".media-item").first().click();
  await page.waitForTimeout(700);

  // Import placed the whole five seconds; the new second lands after it.
  expect(await clips(page)).toEqual([
    [0, 5_000_000],
    [5_000_000, 1_000_000],
  ]);
});

test("insert lands at the playhead and pushes the rest later", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await chooseRange(page, 0, 1_000_000);
  await setEditMode(page, "append");
  await page.locator(".media-item").first().click();
  await page.waitForTimeout(700);
  expect(await clips(page)).toHaveLength(2);

  // Playhead exactly onto the boundary between them. Selecting the second clip
  // puts it there to the microsecond; scrubbing to five-sixths of the ruler
  // lands on 4.998s, which is *inside* the first clip and splits it — correct
  // behaviour, but not the case this test is about.
  await page.locator(".clip").nth(1).click();
  await page.waitForTimeout(400);

  await setEditMode(page, "insert");
  await page.locator(".media-item").first().click();
  await page.waitForTimeout(900);

  // The first clip is untouched, the new one takes 5s–6s, and the clip that
  // was at 5s has been pushed to 6s. Nothing was replaced.
  const after = await clips(page);
  expect(after).toHaveLength(3);
  expect(after[0]).toEqual([0, 5_000_000]);
  expect(after[1]).toEqual([5_000_000, 1_000_000]);
  expect(after[2]).toEqual([6_000_000, 1_000_000]);
});

test("insert mid-clip cuts it in two and keeps every frame", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await chooseRange(page, 0, 1_000_000);

  // Halfway through the only clip.
  await seekFraction(page, 500);
  await page.waitForTimeout(400);

  await setEditMode(page, "insert");
  await page.locator(".media-item").first().click();
  await page.waitForTimeout(900);

  // 2.5s of picture, then the inserted second, then the remaining 2.5s. The
  // total grew by exactly the inserted length: nothing was overwritten.
  const after = await clips(page);
  expect(after).toEqual([
    [0, 2_500_000],
    [2_500_000, 1_000_000],
    [3_500_000, 2_500_000],
  ]);
  const total = after.reduce((sum, [, d]) => sum + d, 0);
  expect(total).toBe(6_000_000);
});

test("overwrite replaces what it covers instead of growing the sequence", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await chooseRange(page, 0, 1_000_000);

  await seekFraction(page, 500); // 2.5s into the 5s clip
  await page.waitForTimeout(400);

  await setEditMode(page, "overwrite");
  await page.locator(".media-item").first().click();
  await page.waitForTimeout(900);

  // The clip is cut around the overwrite, and the sequence is still 5s long —
  // which is the whole difference from insert.
  const after = await clips(page);
  expect(after).toEqual([
    [0, 2_500_000],
    [2_500_000, 1_000_000],
    [3_500_000, 1_500_000],
  ]);
  const total = after.reduce((sum, [, d]) => sum + d, 0);
  expect(total).toBe(5_000_000);
});

test("a ripple across several clips is one undo", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await chooseRange(page, 0, 1_000_000);
  await setEditMode(page, "append");
  for (let i = 0; i < 2; i++) {
    await page.locator(".media-item").first().click();
    await page.waitForTimeout(600);
  }
  const before = await clips(page);
  expect(before).toHaveLength(3);

  await seekFraction(page, 0);
  await page.waitForTimeout(400);
  await setEditMode(page, "insert");
  await page.locator(".media-item").first().click();
  await page.waitForTimeout(900);
  expect(await clips(page)).toHaveLength(4);

  // One press, not four: the insert moved three clips and added one, and that
  // is one thing the person did.
  await page.click("#btn-undo");
  await page.waitForTimeout(700);
  expect(await clips(page)).toEqual(before);
});
