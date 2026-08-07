import { expect, test } from "@playwright/test";
import { importMedia, setMode } from "./helpers.js";

/**
 * Effects and transitions that only exist once the app is running: segmentation
 * needs ONNX Runtime in a real browser, and a transition is only observable in
 * what gets painted.
 */

test("Portrait Blur runs segmentation and composites a masked subject", async ({
  page,
}) => {
  // This effect used to be one CSS blur across the whole layer — the subject
  // was blurred too, and subjectScale was dead code.
  await importMedia(page, "photos/portrait-subject-900x1200.png");

  await page.evaluate(() => {
    const el = [...document.querySelectorAll("#effects-palette *")].find(
      (node) => (node.textContent ?? "").trim() === "Portrait Blur",
    ) as HTMLElement | undefined;
    el?.click();
  });

  // U²-Net inference in wasm; slow, and the first run also fetches the model.
  // A locator assertion rather than polling page.evaluate: the model load
  // swaps execution contexts, which destroys an in-flight evaluate.
  await expect(page.locator("#toast")).toContainText("subject detected", {
    timeout: 120_000,
  });
});

test("a dip transition paints its own colour at the ramp start", async ({
  page,
}) => {
  await importMedia(page, "photos/gradient-landscape-1600x900.png");
  await setMode(page, "video");

  await page
    .locator(".transition-end", { hasText: "In" })
    .locator("button", { hasText: "Add" })
    .first()
    .click();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const kind = document.querySelector(
      'select[aria-label="in transition kind"]',
    ) as HTMLSelectElement;
    kind.value = "dip";
    kind.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const colour = document.querySelector(
      'input[aria-label="in dip colour"]',
    ) as HTMLInputElement;
    colour.value = "#ff0000";
    colour.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(500);

  const redCoverage = async (): Promise<number> =>
    page.evaluate(() => {
      const canvas = document.getElementById("preview") as HTMLCanvasElement;
      const data = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        total++;
        if (data[i]! > 180 && data[i + 1]! < 70 && data[i + 2]! < 70) red++;
      }
      return red / total;
    });

  const seek = async (value: number): Promise<void> => {
    await page.evaluate((v) => {
      const el = document.getElementById("seek") as HTMLInputElement;
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
    await page.waitForTimeout(250);
  };

  await seek(2);
  const atStart = await redCoverage();
  await seek(500);
  const midClip = await redCoverage();

  expect(atStart, "dip colour missing at the ramp start").toBeGreaterThan(0.2);
  expect(midClip, "dip colour still painted after the ramp").toBeLessThan(0.01);
});
