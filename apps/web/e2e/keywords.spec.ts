import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { MEDIA } from "./helpers.js";

/**
 * Keywords and saved views.
 *
 * Keywords are project state and undo like any edit; the search, the keyword
 * picker and a saved view are ways of looking at the bin and deliberately are
 * not. These checks cover both halves, and the boundary between them: a keyword
 * that no longer exists must not linger in the picker as a dead end.
 */

/** Type keywords into the prompt the tag button opens. */
async function tag(page: Page, itemIndex: number, value: string): Promise<void> {
  page.once("dialog", (dialog) => void dialog.accept(value));
  await page.locator(".media-tag").nth(itemIndex).click();
  await page.waitForTimeout(500);
}

async function visibleNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".media-name")].map((node) =>
      (node.textContent ?? "").trim(),
    ),
  );
}

async function importTwo(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.setInputFiles("#file-input", [
    MEDIA + "photos/colour-chart-512x512.jpg",
    MEDIA + "photos/gradient-landscape-1600x900.png",
  ]);
  await expect(page.locator(".media-item")).toHaveCount(2, { timeout: 30_000 });
}

test("keywords tag an asset, filter the bin, and undo", async ({ page }) => {
  await importTwo(page);

  // Mixed case and spacing on purpose: one keyword must have one spelling.
  await tag(page, 0, "Interview, wide  shot");
  await expect(page.locator(".media-keyword-chip")).toHaveCount(2);
  await expect(page.locator(".media-keyword-chip").first()).toHaveText(
    "interview",
  );

  await page.getByLabel("Keyword filter").selectOption("interview");
  expect(await visibleNames(page)).toEqual(["colour-chart-512x512.jpg"]);

  await page.getByLabel("Keyword filter").selectOption("");
  expect(await visibleNames(page)).toHaveLength(2);

  await page.click("#btn-undo");
  await page.waitForTimeout(500);
  await expect(page.locator(".media-keyword-chip")).toHaveCount(0);
});

test("clicking a chip filters, and clicking it again clears", async ({
  page,
}) => {
  await importTwo(page);
  await tag(page, 1, "b-roll");

  await page.locator(".media-keyword-chip").first().click();
  await page.waitForTimeout(400);
  expect(await visibleNames(page)).toEqual(["gradient-landscape-1600x900.png"]);

  await page.locator(".media-keyword-chip").first().click();
  await page.waitForTimeout(400);
  expect(await visibleNames(page)).toHaveLength(2);
});

test("search covers keywords, not only names", async ({ page }) => {
  await importTwo(page);
  await tag(page, 1, "sunset");

  await page.getByLabel("Search media").fill("sunset");
  await page.waitForTimeout(400);
  // The file is called gradient-landscape; only its keyword says sunset.
  expect(await visibleNames(page)).toEqual(["gradient-landscape-1600x900.png"]);
});

test("a saved view restores search, keyword and rating together", async ({
  page,
}) => {
  await importTwo(page);
  await tag(page, 0, "interview");
  await page
    .getByRole("button", { name: "Favorite colour-chart-512x512.jpg" })
    .click();
  await page.waitForTimeout(400);

  await page.getByLabel("Keyword filter").selectOption("interview");
  await page.getByLabel("Media filter").selectOption("favorites");
  page.once("dialog", (dialog) => void dialog.accept("Selects"));
  await page.click("#btn-save-view");
  await page.waitForTimeout(400);

  // Reset the view by hand, then restore it from the picker.
  await page.getByLabel("Keyword filter").selectOption("");
  await page.getByLabel("Media filter").selectOption("all");
  expect(await visibleNames(page)).toHaveLength(2);

  await page.getByLabel("Saved view").selectOption("Selects");
  await page.waitForTimeout(400);
  expect(await visibleNames(page)).toEqual(["colour-chart-512x512.jpg"]);
  await expect(page.getByLabel("Media filter")).toHaveValue("favorites");
});

test("a keyword nobody uses disappears from the picker", async ({ page }) => {
  await importTwo(page);
  await tag(page, 0, "temporary");
  await expect(page.getByLabel("Keyword filter")).toContainText("temporary");

  await tag(page, 0, "");
  await page.waitForTimeout(400);
  await expect(page.getByLabel("Keyword filter")).not.toContainText(
    "temporary",
  );
});
