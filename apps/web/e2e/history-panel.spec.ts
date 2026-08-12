import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { importMedia, setMode } from "./helpers.js";

/**
 * The navigable history panel.
 *
 * The operation log and replay have existed since the foundation; the panel was
 * a read-only list that always marked its last row as current, which stopped
 * being true the moment anything was undone. This makes it a control.
 *
 * The claim worth testing is that clicking an entry *moves the project*, and
 * that where it lands matches where pressing Undo that many times would.
 */

const SOURCE = "video/motion-1280x720-5s.mp4";

async function clipCount(page: Page): Promise<number> {
  return page.locator(".clip").count();
}

async function addClips(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await page.locator(".media-item").first().click();
    await page.waitForTimeout(500);
  }
}

test("entries are named after the action, not the command type", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 1);

  const entries = page.locator(".history-item");
  // Importing is the first thing above the baseline: the project, sequence and
  // track are seeded below it and are not the user's edits.
  await expect(entries.first()).toContainText("Import media");
  await expect(entries.last()).toContainText("Add clip");
  // The raw types would read "asset.register" and "timeline.add_clip", which
  // describe the engine rather than the action.
  const text = (await entries.allTextContents()).join(" ");
  expect(text).not.toContain("timeline.");
  expect(text).not.toContain("asset.");
});

test("clicking an earlier entry takes the project back to it", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 3);
  const before = await clipCount(page);
  expect(before).toBeGreaterThanOrEqual(4);

  // Go back to the first user edit.
  await page.locator(".history-item").first().click();
  await page.waitForTimeout(700);
  expect(await clipCount(page)).toBeLessThan(before);
});

test("the steps ahead stay listed, and clicking one goes forward again", async ({
  page,
}) => {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 3);
  const full = await clipCount(page);
  const steps = await page.locator(".history-item").count();

  await page.locator(".history-item").first().click();
  await page.waitForTimeout(700);
  const rewound = await clipCount(page);
  expect(rewound).toBeLessThan(full);

  // The list does not shrink: the redo branch is drawn, not hidden, so the way
  // forward is visible rather than something you must remember.
  expect(await page.locator(".history-item").count()).toBe(steps);
  await expect(page.locator(".history-item.undone").first()).toBeVisible();

  await page.locator(".history-item").last().click();
  await page.waitForTimeout(900);
  expect(await clipCount(page)).toBe(full);
});

test("the current marker follows the present, not the end of the list", async ({
  page,
}) => {
  // The old panel always marked its last row current, which was wrong as soon
  // as anything was undone.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 3);
  const steps = await page.locator(".history-item").count();

  await page.click("#btn-undo");
  await page.waitForTimeout(600);

  const current = page.locator(".history-item.current");
  await expect(current).toHaveCount(1);
  await expect(current).toHaveAttribute("aria-current", "step");
  // Marked on the second-to-last step, not the last.
  const currentIndex = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".history-item")];
    return items.findIndex((el) => el.classList.contains("current"));
  });
  expect(currentIndex).toBe(steps - 2);
});

test("clicking a step matches pressing Undo the same number of times", async ({
  page,
}) => {
  // Two ways of moving through history that disagreed would be worse than one,
  // so the panel steps rather than jumping.
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 3);
  const steps = await page.locator(".history-item").count();

  await page.click("#btn-undo");
  await page.click("#btn-undo");
  await page.waitForTimeout(800);
  const viaButton = await clipCount(page);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await addClips(page, 3);
  await page.locator(".history-item").nth(steps - 3).click();
  await page.waitForTimeout(800);

  expect(await clipCount(page)).toBe(viaButton);
});
