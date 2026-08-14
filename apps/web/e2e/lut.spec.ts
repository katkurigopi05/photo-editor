import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { importMedia, previewSignature, setMode } from "./helpers.js";

/**
 * Importing and exporting `.cube` lookup tables.
 *
 * The format handling is unit-tested. What only this can check is that a table
 * chosen in the Inspector actually reaches the picture, that it is one Undo,
 * and that exporting produces a file that reads back as the same grade.
 *
 * The LUTs here are generated in the page rather than committed as fixtures,
 * so what each one does is known exactly: a swap of red and blue is unmistakable
 * in a preview and cannot be confused with a subtle grade drifting.
 */

const SOURCE = "photos/colour-chart-512x512.jpg";

/** A `.cube` that swaps red and blue — a change no ordinary grade produces. */
function swapCube(size = 2): string {
  const lines = ['TITLE "Swap RB"', `LUT_3D_SIZE ${size}`];
  const last = size - 1;
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        // Output red takes the blue axis and vice versa.
        lines.push(`${b / last} ${g / last} ${r / last}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Choose a file on the LUT input without a real file dialog. */
async function importLut(page: Page, text: string, name = "swap.cube") {
  await page.evaluate(
    ([body, filename]) => {
      const input = document.getElementById(
        "lut-file-input",
      ) as HTMLInputElement;
      const transfer = new DataTransfer();
      transfer.items.add(new File([body!], filename!, { type: "text/plain" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [text, name],
  );
}

async function selectClip(page: Page): Promise<void> {
  await importMedia(page, SOURCE);
  // Video mode, not photo: photo mode hides the timeline, so `.clip` is in the
  // DOM with no bounding box and a click on it waits forever for an element
  // that will never become clickable. The grade path is the same in both.
  await setMode(page, "video");
  await page.locator(".clip").first().click();
  await page.waitForTimeout(600);
}

test("the import and export controls are in the Inspector", async ({
  page,
}) => {
  await selectClip(page);
  await expect(page.locator("#btn-lut-import")).toBeVisible();
  await expect(page.locator("#btn-lut-export")).toBeVisible();
});

test("an imported LUT changes the picture", async ({ page }) => {
  await selectClip(page);
  const before = await previewSignature(page);

  await importLut(page, swapCube());
  await expect(page.locator("#toast")).toContainText("Swap RB", {
    timeout: 10_000,
  });
  await page.waitForTimeout(900);

  const after = await previewSignature(page);
  // Swapping red and blue on a colour chart is a large, unmistakable change.
  expect(
    after.reduce((sum, v, i) => sum + Math.abs(v - before[i]!), 0) /
      after.length,
  ).toBeGreaterThan(4);
});

test("importing a LUT is one Undo", async ({ page }) => {
  // Registering the asset and adding the effect are two commands; they must
  // come off together or Undo leaves an asset nothing refers to.
  await selectClip(page);
  const before = await previewSignature(page);

  await importLut(page, swapCube());
  await page.waitForTimeout(1000);

  await page.click("#btn-undo");
  await page.waitForTimeout(1000);

  const after = await previewSignature(page);
  expect(
    after.reduce((sum, v, i) => sum + Math.abs(v - before[i]!), 0) /
      after.length,
  ).toBeLessThan(3);
});

test("a malformed .cube is refused with the reason, not applied", async ({
  page,
}) => {
  await selectClip(page);
  const before = await previewSignature(page);

  // Declares size 2 — which needs eight entries — and supplies three.
  await importLut(page, "LUT_3D_SIZE 2\n0 0 0\n1 1 1\n0.5 0.5 0.5\n", "bad.cube");
  await expect(page.locator("#toast")).toContainText("bad.cube", {
    timeout: 10_000,
  });
  await expect(page.locator("#toast")).toHaveClass(/error/);
  await page.waitForTimeout(600);

  // And the picture is untouched.
  const after = await previewSignature(page);
  expect(
    after.reduce((sum, v, i) => sum + Math.abs(v - before[i]!), 0) /
      after.length,
  ).toBeLessThan(3);
});

test("a 1D LUT is refused by name rather than misread", async ({ page }) => {
  await selectClip(page);
  await importLut(page, "LUT_1D_SIZE 32\n0 0 0\n", "curves.cube");
  await expect(page.locator("#toast")).toContainText("only 3D LUTs", {
    timeout: 10_000,
  });
});

test("exporting with no grade says so instead of writing an empty table", async ({
  page,
}) => {
  await selectClip(page);
  await page.click("#btn-lut-export");
  await expect(page.locator("#toast")).toContainText("no colour grade", {
    timeout: 10_000,
  });
  await expect(page.locator("#toast")).toHaveClass(/error/);
});

test("an exported grade reads back as the same grade", async ({ page }) => {
  // The round trip through the real UI: apply a LUT, export, and check the
  // written file parses and is not the identity.
  await selectClip(page);
  await importLut(page, swapCube());
  await page.waitForTimeout(1000);

  const download = page.waitForEvent("download", { timeout: 20_000 });
  await page.click("#btn-lut-export");
  const file = await download;
  expect(file.suggestedFilename()).toBe("grade.cube");

  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");

  expect(text).toContain("LUT_3D_SIZE 33");
  // The first data row is the table's black entry. A red/blue swap leaves black
  // alone, so check a row where the swap shows: the second entry steps along
  // red, which the swapped table reports as blue.
  const rows = text
    .split("\n")
    .filter((line) => /^[\d.]+\s/.test(line))
    .map((line) => line.trim().split(/\s+/).map(Number));
  expect(rows.length).toBe(33 * 33 * 33);
  const second = rows[1]!;
  expect(second[2]!).toBeGreaterThan(second[0]!);
});
