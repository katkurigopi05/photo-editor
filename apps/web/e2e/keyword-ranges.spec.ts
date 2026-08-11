import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { importMedia, setMode } from "./helpers.js";

/**
 * Keyword ranges through the real controls.
 *
 * A keyword over *part* of a shot, saved with the project — unlike the browser
 * range beside it, which is an intention about the next add and dies with the
 * session. What has to be true: the tag lands on the span the sliders describe,
 * it survives undo as project state, clicking it loads that span back, and the
 * bin's search and picker both reach a keyword that only ever named a range.
 */

const SOURCE = "video/motion-1280x720-5s.mp4";

async function openRange(page: Page): Promise<void> {
  await page.locator(".media-range-btn").first().click();
  await page.waitForTimeout(300);
}

async function setSlider(
  page: Page,
  label: string,
  value: number,
): Promise<void> {
  const slider = page.locator(`input[type="range"][aria-label^="${label}"]`);
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await page.waitForTimeout(200);
}

/** Tag the span the sliders currently describe. */
async function keywordRange(page: Page, keyword: string): Promise<void> {
  page.once("dialog", (dialog) => void dialog.accept(keyword));
  await page.getByRole("button", { name: "Keyword this range" }).click();
  await page.waitForTimeout(500);
}

/** Durations of the clips on the timeline, in microseconds. */
async function clipDurations(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".clip")].map((clip) =>
      Number((clip as HTMLElement).dataset.durationUs ?? "0"),
    ),
  );
}

async function tagged(page: Page, keyword: string, from: number, to: number) {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await openRange(page);
  await setSlider(page, "In", from);
  await setSlider(page, "Out", to);
  await keywordRange(page, keyword);
}

test("a range is tagged over the span the sliders describe", async ({
  page,
}) => {
  // Mixed case on purpose: normalization happens at this boundary, because the
  // schema refuses an unnormalized keyword rather than quietly fixing it.
  await tagged(page, "Good Take", 1_000_000, 3_000_000);

  const chip = page.locator(".media-range-chip");
  await expect(chip).toHaveCount(1);
  await expect(chip.locator(".media-range-use")).toHaveText(
    "good take 00:01.000–00:03.000",
  );
  // The bounds are what the state actually holds, not what the label rounded to.
  await expect(chip).toHaveAttribute("data-start-us", "1000000");
  await expect(chip).toHaveAttribute("data-end-us", "3000000");
});

test("a keyword range is project state and undoes", async ({ page }) => {
  // The browser range beside it is not, which is the distinction being drawn:
  // one goes through the command engine, the other never does.
  await tagged(page, "good take", 1_000_000, 3_000_000);
  await expect(page.locator(".media-range-chip")).toHaveCount(1);

  await page.click("#btn-undo");
  await page.waitForTimeout(500);
  await expect(page.locator(".media-range-chip")).toHaveCount(0);

  await page.click("#btn-redo");
  await page.waitForTimeout(500);
  await expect(page.locator(".media-range-chip")).toHaveCount(1);
});

test("clicking a range loads it as the range to add", async ({ page }) => {
  await tagged(page, "good take", 1_000_000, 3_000_000);

  // Clear the transient range so the click is what sets it, not a leftover.
  await openRange(page);
  await page.getByRole("button", { name: "Whole clip" }).click();
  await page.waitForTimeout(400);
  await expect(page.locator(".media-range-label")).toHaveCount(0);

  await page.locator(".media-range-use").first().click();
  await page.waitForTimeout(400);
  await expect(page.locator(".media-range-label")).toContainText("00:01.000");

  // And the next add uses it: two seconds, not the whole five.
  await page.locator(".media-item").first().click();
  await page.waitForTimeout(700);
  const durations = await clipDurations(page);
  expect(durations[durations.length - 1]).toBe(2_000_000);
});

test("search and the picker both reach a range keyword", async ({ page }) => {
  // The keyword names a range and nothing else — the asset's own keyword list
  // is empty — so this fails if the filters only look at that list.
  await tagged(page, "sunset", 0, 2_000_000);
  await expect(page.locator(".media-keyword-chip")).toHaveCount(0);

  await expect(page.getByLabel("Keyword filter")).toContainText("sunset");
  await page.getByLabel("Keyword filter").selectOption("sunset");
  await page.waitForTimeout(400);
  await expect(page.locator(".media-item")).toHaveCount(1);

  await page.getByLabel("Keyword filter").selectOption("");
  await page.getByLabel("Search media").fill("sunset");
  await page.waitForTimeout(400);
  await expect(page.locator(".media-item")).toHaveCount(1);

  // A keyword nothing carries filters everything out, which is what proves the
  // match above came from the range rather than from the filter being ignored.
  await page.getByLabel("Search media").fill("nothing-has-this");
  await page.waitForTimeout(400);
  await expect(page.locator(".media-item")).toHaveCount(0);
});

test("a range can be removed on its own", async ({ page }) => {
  await tagged(page, "good take", 1_000_000, 3_000_000);

  await openRange(page);
  await setSlider(page, "In", 3_000_000);
  await setSlider(page, "Out", 4_000_000);
  await keywordRange(page, "b-roll");
  await expect(page.locator(".media-range-chip")).toHaveCount(2);

  // Drop the first; the other is untouched.
  await page.locator(".media-range-drop").first().click();
  await page.waitForTimeout(500);
  await expect(page.locator(".media-range-chip")).toHaveCount(1);
  await expect(page.locator(".media-range-use")).toContainText("b-roll");
});

test("an empty keyword is refused rather than stored", async ({ page }) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await openRange(page);
  await keywordRange(page, "   ");
  await expect(page.locator(".media-range-chip")).toHaveCount(0);
});
