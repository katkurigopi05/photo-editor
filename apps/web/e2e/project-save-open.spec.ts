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
