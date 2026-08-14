import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { importMedia, setMode } from "./helpers.js";

/**
 * Keyboard-first navigation and trimming.
 *
 * The rules are unit-tested. What only this can check is that the keys reach
 * them: every one of these is bound on `window` and guarded by
 * `e.target === document.body`, so a handler that never fires looks exactly
 * like a feature that was never built.
 *
 * The timecode readout is the observable throughout. It is what the user reads
 * to know where the playhead is, so a test that agrees with it is testing the
 * thing the user sees rather than internal state.
 */

const SOURCE = "video/motion-1280x720-5s.mp4";

async function timeline(page: Page): Promise<void> {
  await importMedia(page, SOURCE);
  await setMode(page, "video");
  await page.waitForTimeout(400);
  // Focus the body: the handler ignores keys aimed at inputs, so that a
  // shortcut cannot fire while somebody is typing a clip name.
  await page.locator("body").click({ position: { x: 5, y: 5 } });
}

const timecode = (page: Page) => page.locator("#timecode");

/** What the readout shows at zero, read from the page rather than assumed.
 * The display format is not this feature's contract, and hard-coding it makes
 * the test fail on a formatting change that broke nothing. */
async function zeroReading(page: Page): Promise<string> {
  await page.keyboard.press("Home");
  await page.waitForTimeout(250);
  return (await timecode(page).textContent()) ?? "";
}

test("arrow keys step the playhead a frame at a time", async ({ page }) => {
  await timeline(page);
  const start = await timecode(page).textContent();

  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  const stepped = await timecode(page).textContent();
  expect(stepped, "the right arrow did not move the playhead").not.toBe(start);

  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(250);
  // A step forward and back must return exactly, or stepping drifts off the
  // frame grid and the playhead creeps over a long edit.
  expect(await timecode(page).textContent()).toBe(start);
});

test("shift-arrow covers a second, not a frame", async ({ page }) => {
  await timeline(page);
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(250);
  const far = await timecode(page).textContent();

  await page.keyboard.press("Home");
  await page.waitForTimeout(250);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  const near = await timecode(page).textContent();

  expect(far).not.toBe(near);
});

test("Home and End reach the ends of the sequence", async ({ page }) => {
  await timeline(page);
  const zero = await zeroReading(page);

  await page.keyboard.press("End");
  await page.waitForTimeout(300);
  expect(await timecode(page).textContent()).not.toBe(zero);

  await page.keyboard.press("Home");
  await page.waitForTimeout(300);
  expect(await timecode(page).textContent()).toBe(zero);
});

test("Down jumps to the next cut and Up comes back", async ({ page }) => {
  await timeline(page);
  const zero = await zeroReading(page);

  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
  expect(
    await timecode(page).textContent(),
    "Down did not reach an edit point",
  ).not.toBe(zero);

  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(300);
  expect(await timecode(page).textContent()).toBe(zero);
});

test("L plays, K stops, and J runs it backwards", async ({ page }) => {
  await timeline(page);

  await page.keyboard.press("KeyL");
  await page.waitForTimeout(900);
  await page.keyboard.press("KeyK");
  await page.waitForTimeout(300);
  const afterForward = Number(
    (await timecode(page).textContent())!.replace(/[:.]/g, ""),
  );
  expect(afterForward, "L did not advance the playhead").toBeGreaterThan(0);

  await page.keyboard.press("KeyJ");
  await page.waitForTimeout(900);
  await page.keyboard.press("KeyK");
  await page.waitForTimeout(300);
  const afterBack = Number(
    (await timecode(page).textContent())!.replace(/[:.]/g, ""),
  );
  // Reverse playback is the half that did not exist before: the transport
  // asserted a positive rate, so time could only ever run forwards.
  expect(afterBack, "J did not run the playhead backwards").toBeLessThan(
    afterForward,
  );
});

test("repeated L shuttles faster", async ({ page }) => {
  await timeline(page);
  await page.keyboard.press("KeyL");
  await page.keyboard.press("KeyL");
  // The indicator, not a toast: a toast disappears, and an editor shuttling
  // needs to see the speed for as long as it is running.
  await expect(page.locator("#shuttle-indicator")).toHaveText("2×", {
    timeout: 5000,
  });
  await page.keyboard.press("KeyK");
  // And it clears on stop, rather than leaving a speed showing while paused.
  await expect(page.locator("#shuttle-indicator")).toBeHidden();
});

test("[ trims the clip's head to the playhead, as one Undo", async ({
  page,
}) => {
  await timeline(page);
  await page.locator(".clip").first().click();
  await page.waitForTimeout(300);

  const boxOf = async () => {
    const box = (await page.locator(".clip").first().boundingBox())!;
    return { x: box.x, width: box.width };
  };
  const before = await boxOf();

  // Somewhere inside the clip.
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.press("BracketLeft");
  await page.waitForTimeout(600);

  const after = await boxOf();
  expect(after.width, "the clip did not get shorter").toBeLessThan(
    before.width - 2,
  );
  // And it starts later than it did. Checking only the width passes even when
  // the move is skipped: the clip still shortens, it just keeps its old start,
  // so the trimmed frames come off the wrong end and the content slides.
  expect(after.x, "the clip's start did not move to the playhead").toBeGreaterThan(
    before.x + 2,
  );
  // The two edges must have moved together — a head trim removes from the
  // front, so the right edge stays put.
  expect(
    Math.abs(after.x + after.width - (before.x + before.width)),
  ).toBeLessThan(3);

  // A head trim is a trim plus a move; both must come off together or the clip
  // jumps sideways on Undo.
  await page.click("#btn-undo");
  await page.waitForTimeout(600);
  const back = await boxOf();
  expect(Math.abs(back.width - before.width)).toBeLessThan(3);
  expect(Math.abs(back.x - before.x)).toBeLessThan(3);
});

test("trimming is refused when the playhead is outside the clip", async ({
  page,
}) => {
  await timeline(page);
  await page.locator(".clip").first().click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Home");
  await page.waitForTimeout(300);

  // At the very start the head trim would leave the clip unchanged or empty.
  await page.keyboard.press("BracketLeft");
  await expect(page.locator("#toast")).toContainText("inside the clip", {
    timeout: 5000,
  });
});
