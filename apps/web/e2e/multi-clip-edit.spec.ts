import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { importMedia, MEDIA, seekFraction, setMode } from "./helpers.js";

/**
 * Applying an edit to several clips at once.
 *
 * The selection already existed but only drove Delete, so grading a shoot meant
 * repeating the same click per clip. What has to be true now: the palette and
 * Looks cover every selected clip, they cover *only* those clips, and the whole
 * apply is one Undo — a look made of five effects across three clips must not
 * take fifteen presses to remove.
 */

/** Mean colourfulness of the preview: max-minus-min per pixel. */
const SPREAD_FN = `(function(data){
  let spread=0,n=0;
  for(let i=0;i<data.length;i+=4){
    if(data[i+3]===0) continue;
    spread+=Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2]);
    n++;
  }
  return n===0?0:spread/n;
})`;

async function previewSpread(page: Page): Promise<number> {
  return page.evaluate((fn) => {
    const canvas = document.getElementById("preview") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return eval(fn)(data) as number;
  }, SPREAD_FN);
}

/** Three colourful photos, end to end on the video track. */
async function importThree(page: Page): Promise<void> {
  await importMedia(page, "photos/colour-chart-512x512.jpg");
  for (const file of [
    "photos/gradient-landscape-1600x900.png",
    "photos/colour-chart-1024x1024.png",
  ]) {
    await page.setInputFiles("#file-input", MEDIA + file);
    await page.waitForTimeout(700);
  }
  await setMode(page, "video");
  await page.evaluate(() => {
    const zoom = document.getElementById("zoom") as HTMLInputElement;
    zoom.value = "40";
    zoom.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(400);
}

/** Click a clip by index, optionally adding it to the selection. */
async function clickClip(
  page: Page,
  index: number,
  additive = false,
): Promise<void> {
  await page.evaluate(
    ({ i, add }) => {
      const clip = [...document.querySelectorAll(".clip")][i] as HTMLElement;
      const box = clip.getBoundingClientRect();
      const init = {
        bubbles: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
        shiftKey: add,
      };
      clip.dispatchEvent(new PointerEvent("pointerdown", init));
      window.dispatchEvent(new PointerEvent("pointerup", init));
    },
    { i: index, add: additive },
  );
  await page.waitForTimeout(500);
}

/** Each clip is five seconds; seek into the middle of clip `index` of three. */
async function seekIntoClip(page: Page, index: number): Promise<void> {
  await seekFraction(page, Math.round(((index + 0.5) / 3) * 1000));
  await page.waitForTimeout(700);
}

test("a Look applies to every selected clip and to no others", async ({
  page,
}) => {
  await importThree(page);

  const spreads: number[] = [];
  for (const index of [0, 1, 2]) {
    await seekIntoClip(page, index);
    spreads.push(await previewSpread(page));
  }
  for (const spread of spreads) expect(spread).toBeGreaterThan(5);

  // Select the first two, leave the third alone.
  await clickClip(page, 0);
  await clickClip(page, 1, true);
  await expect(page.locator(".clip.selected")).toHaveCount(2);
  await expect(page.locator("#selection-hint")).toContainText("2 clips");

  await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".look-chip")].find(
      (node) => (node.textContent ?? "").trim() === "B&W",
    ) as HTMLElement;
    chip.click();
  });
  await page.waitForTimeout(800);

  await seekIntoClip(page, 0);
  expect(await previewSpread(page)).toBeLessThan(2);
  await seekIntoClip(page, 1);
  expect(await previewSpread(page)).toBeLessThan(2);
  // The unselected clip keeps its colour — the apply was scoped, not global.
  await seekIntoClip(page, 2);
  expect(await previewSpread(page)).toBeGreaterThan(5);
});

test("one Undo removes a Look from every clip it was applied to", async ({
  page,
}) => {
  await importThree(page);
  await clickClip(page, 0);
  await clickClip(page, 1, true);

  await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".look-chip")].find(
      (node) => (node.textContent ?? "").trim() === "B&W",
    ) as HTMLElement;
    chip.click();
  });
  await page.waitForTimeout(800);

  await page.click("#btn-undo");
  await page.waitForTimeout(800);

  // Both clips have their colour back after a single press, even though the
  // apply issued one command per effect per clip.
  for (const index of [0, 1]) {
    await seekIntoClip(page, index);
    expect(await previewSpread(page)).toBeGreaterThan(5);
  }
});

test("an effect from the palette also covers the selection", async ({
  page,
}) => {
  await importThree(page);
  await clickClip(page, 0);
  await clickClip(page, 1, true);

  // Saturation rather than a Look: it is offered in video mode, and its
  // default is a no-op, so this checks the *stack* rather than the pixels —
  // which is the right question for "did the apply reach every selected clip".
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll("#effects-palette *")].find(
      (node) => (node.textContent ?? "").trim() === "Saturation",
    ) as HTMLElement;
    chip.click();
  });
  await page.waitForTimeout(800);

  await expect(page.locator("#toast")).toContainText("2 clips");

  const effectNames = async (): Promise<string[]> =>
    page.evaluate(() =>
      [...document.querySelectorAll("#inspector .fx-name")].map((node) =>
        (node.textContent ?? "").trim(),
      ),
    );

  await clickClip(page, 1);
  expect(await effectNames()).toContain("Saturation");
  await clickClip(page, 0);
  expect(await effectNames()).toContain("Saturation");
  // And the clip that was never selected is untouched.
  await clickClip(page, 2);
  expect(await effectNames()).not.toContain("Saturation");
});
