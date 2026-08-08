import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { downloadBytes, importMedia, MEDIA, setMode } from "./helpers.js";

/**
 * Saving and opening a project.
 *
 * Until now closing the tab lost everything, so these checks are about the
 * whole round trip: the file the app writes, replayed back into an app that has
 * never seen it, producing the same timeline — and the one thing a browser
 * cannot carry across, the media itself, being found again by relinking rather
 * than silently rendering black.
 */

declare global {
  interface Window {
    __pickerCalls: number;
  }
}

const SCRATCH = "/tmp/director-e2e-project.json";

async function clipCount(page: Page): Promise<number> {
  return page.locator(".clip").count();
}

test("a saved project reopens with its timeline intact", async ({ page }) => {
  await importMedia(page, "photos/colour-chart-512x512.jpg");
  await setMode(page, "video");
  await page.setInputFiles(
    "#file-input",
    MEDIA + "photos/gradient-landscape-1600x900.png",
  );
  await page.waitForTimeout(800);
  expect(await clipCount(page)).toBe(2);

  // Something to prove the *edits* survive, not only the clips.
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".look-chip")].find(
      (node) => (node.textContent ?? "").trim() === "B&W",
    ) as HTMLElement;
    chip.click();
  });
  await page.waitForTimeout(600);

  const bytes = await downloadBytes(page, "#btn-save-project");
  writeFileSync(SCRATCH, bytes);
  const saved = JSON.parse(readFileSync(SCRATCH, "utf8")) as {
    format: string;
    operations: unknown[];
    media: { name: string }[];
  };
  expect(saved.format).toBe("project-director.project");
  expect(saved.operations.length).toBeGreaterThan(3);
  expect(saved.media.map((m) => m.name).sort()).toEqual([
    "colour-chart-512x512.jpg",
    "gradient-landscape-1600x900.png",
  ]);

  // A fresh app, then the file.
  await page.goto("/", { waitUntil: "networkidle" });
  await page.setInputFiles("#project-input", SCRATCH);
  await page.waitForTimeout(1200);
  // The mode is how someone is working, not part of the project, so a fresh
  // app opens in Photo mode whatever the file was saved from.
  await setMode(page, "video");

  expect(await clipCount(page)).toBe(2);
  // The media cannot come back with it: the bin says so instead of pretending.
  await expect(page.locator("#media-relink")).toBeVisible();
  await expect(page.locator("#media-relink-text")).toContainText("2 files");
  await expect(page.locator(".media-item.offline")).toHaveCount(2);

  // The effect stack survived the round trip. The Look went onto the clip that
  // was selected when it was applied — importing selects what it just added —
  // which is the second one.
  await page.locator(".clip").nth(1).click();
  await page.waitForTimeout(500);
  const effects = await page.evaluate(() =>
    [...document.querySelectorAll("#inspector .fx-name")].map((node) =>
      (node.textContent ?? "").trim(),
    ),
  );
  expect(effects).toContain("Grayscale");
});

test("relinking restores the picture, matching renamed files by checksum", async ({
  page,
}) => {
  await importMedia(page, "photos/colour-chart-512x512.jpg");
  const bytes = await downloadBytes(page, "#btn-save-project");
  writeFileSync(SCRATCH, bytes);

  await page.goto("/", { waitUntil: "networkidle" });
  await page.setInputFiles("#project-input", SCRATCH);
  await page.waitForTimeout(1000);
  await expect(page.locator(".media-item.offline")).toHaveCount(1);

  // Renamed on purpose: the same bytes are the same media, and the checksum is
  // what says so.
  const renamed = "/tmp/director-e2e-renamed.jpg";
  writeFileSync(
    renamed,
    readFileSync(MEDIA + "photos/colour-chart-512x512.jpg"),
  );
  await page.setInputFiles("#relink-input", renamed);
  await page.waitForTimeout(1500);

  await expect(page.locator(".media-item.offline")).toHaveCount(0);
  await expect(page.locator("#media-relink")).toBeHidden();

  // And the preview paints the picture again rather than nothing.
  const painted = await page.evaluate(() => {
    const canvas = document.getElementById("preview") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
    return opaque / (data.length / 4);
  });
  expect(painted).toBeGreaterThan(0.2);
});

test("a file that is not a project is refused by name", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const notAProject = "/tmp/director-e2e-not-a-project.json";
  writeFileSync(notAProject, JSON.stringify({ hello: "world" }));
  await page.setInputFiles("#project-input", notAProject);
  await page.waitForTimeout(600);

  await expect(page.locator("#toast")).toContainText("not a Project Director");
  expect(await clipCount(page)).toBe(0);
});

/**
 * A stubbed file picker.
 *
 * Playwright cannot drive the real one — it is browser chrome — so this stands
 * a handle in its place that records every write and counts how often the
 * picker was opened. The count is the whole point: the second save must not
 * open it.
 */
const STUB_PICKER = `
  window.__pickerCalls = 0;
  window.showSaveFilePicker = async () => {
    window.__pickerCalls++;
    // A real handle, from the origin-private file system, so it survives being
    // stored in IndexedDB the way a picked one does. A hand-made object with
    // methods on it would fail to structured-clone and quietly test nothing.
    const root = await navigator.storage.getDirectory();
    return root.getFileHandle("stub-project.json", { create: true });
  };
`;

/** What the stub handle holds, read back through the same file system. */
async function writtenProject(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("stub-project.json");
    return (await handle.getFile()).text();
  });
}

test("saving again writes to the same file without asking", async ({
  page,
}) => {
  await page.addInitScript(STUB_PICKER);
  await importMedia(page, "photos/colour-chart-512x512.jpg");
  await setMode(page, "video");

  await page.click("#btn-save-project");
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__pickerCalls)).toBe(1);
  const first = await writtenProject(page);

  // An edit, then Save again. The file is already known, so no second prompt.
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".look-chip")].find(
      (node) => (node.textContent ?? "").trim() === "B&W",
    ) as HTMLElement;
    chip.click();
  });
  await page.waitForTimeout(600);
  await page.click("#btn-save-project");
  await page.waitForTimeout(800);

  expect(await page.evaluate(() => window.__pickerCalls)).toBe(1);
  // And it wrote the newer project over the old one, rather than nothing.
  const second = await writtenProject(page);
  expect(second).not.toBe(first);
  expect(JSON.parse(second).operations.length).toBeGreaterThan(
    JSON.parse(first).operations.length,
  );

  // Save As is the way to ask again — by button, and by the shortcut.
  await page.click("#btn-save-as");
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__pickerCalls)).toBe(2);
  // Shortcuts only fire when nothing has focus; the Save As button still does.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__pickerCalls)).toBe(3);
});

test("a saved project joins the recent list and reopens from it", async ({
  page,
}) => {
  await page.addInitScript(STUB_PICKER);
  await importMedia(page, "photos/colour-chart-512x512.jpg");
  await setMode(page, "video");
  await page.click("#btn-save-project");
  await page.waitForTimeout(800);

  const recent = page.locator("#recent-projects");
  await expect(recent.locator("option")).toHaveCount(2);
  await expect(recent.locator("option").nth(1)).toHaveText("stub-project.json");

  // A fresh app remembers it — the handle lives in IndexedDB, not in the page.
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await expect(page.locator("#recent-projects option")).toHaveCount(2);
  expect(await clipCount(page)).toBe(0);

  await page.selectOption("#recent-projects", "stub-project.json");
  await page.waitForTimeout(1500);
  await setMode(page, "video");
  expect(await clipCount(page)).toBe(1);
  // The picker was never opened to get here.
  expect(await page.evaluate(() => window.__pickerCalls)).toBe(0);
});
