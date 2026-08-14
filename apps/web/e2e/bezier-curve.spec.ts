import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Drawing a keyframe's easing curve by hand.
 *
 * The geometry is unit-tested and the reducer is tested in editor-state. What
 * only this can check is that dragging a handle on the real canvas reaches the
 * project, that the drag is a single Undo rather than one per pointer move, and
 * that "Use named easing" actually removes the curve — the last of which is the
 * case the reducer used to get wrong silently, by preserving whatever curve was
 * already there.
 */

/** The scale control, which the loop-pulse preset always keyframes. */
const SCALE = ".animation-control:has-text('Scale')";

async function animatedClip(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Add an animatable Star cartoon clip" })
    .click();
  await expect(page.locator(".animation-section")).toBeVisible();
  await page.getByLabel("Auto animation preset").selectOption("loop-pulse");
  await page
    .locator(".animation-auto-row")
    .getByRole("button", { name: "Apply" })
    .click();
  await expect(page.locator(SCALE)).toContainText(/[1-9] keyframes?/);
}

/**
 * Whether the keyframe *stores* a curve, read from the control's own label.
 *
 * Deliberately not a test-only global reaching into the project: the toggle
 * shows a tick exactly when the keyframe it points at has a `bezier`, so this
 * asks the same question the user does, through the same surface.
 */
async function hasStoredCurve(page: Page): Promise<boolean> {
  const label = await page
    .locator(SCALE)
    .getByRole("button", { name: /keyframe curve/ })
    .textContent();
  return (label ?? "").includes("\u2713");
}

/** The four control-point numbers the editor is showing. After a commit the
 * panel is rebuilt from the stored keyframe, so these are what was saved. */
async function readoutCurve(page: Page): Promise<number[]> {
  const text = (await page.locator(".bezier-readout").textContent()) ?? "";
  const inside = text.slice(text.indexOf("(") + 1, text.indexOf(")"));
  return inside.split(",").map((part) => Number(part.trim()));
}

async function openCurve(page: Page): Promise<void> {
  const toggle = page.locator(SCALE).getByRole("button", { name: /keyframe curve/ });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(page.locator(".bezier-canvas")).toBeVisible();
}

/** Drag a control point to a place in the canvas, in canvas fractions. */
async function dragHandle(
  page: Page,
  from: { fx: number; fy: number },
  to: { fx: number; fy: number },
): Promise<void> {
  const canvas = page.locator(".bezier-canvas");
  // Viewport coordinates, via the element's own box — `page.mouse` does not
  // know about scroll position, and an element below the fold is otherwise
  // dragged somewhere else entirely.
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the curve canvas has no bounding box");
  await page.mouse.move(box.x + box.width * from.fx, box.y + box.height * from.fy);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to.fx, box.y + box.height * to.fy, {
    steps: 12,
  });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

test("the curve editor opens on a keyframe and starts from its easing", async ({
  page,
}) => {
  await animatedClip(page);
  await openCurve(page);
  // Opening must not change the animation, so the readout shows the curve the
  // keyframe already had rather than a straight line.
  await expect(page.locator(".bezier-readout")).toContainText(/cubic-bezier\(/);
  expect(await hasStoredCurve(page)).toBe(false);
  // Opening on an unshaped keyframe starts from its named easing, not a line.
  expect(await readoutCurve(page)).not.toEqual([0, 0, 1, 1]);
});

test("dragging a handle stores a curve on the keyframe", async ({ page }) => {
  await animatedClip(page);
  await openCurve(page);
  expect(await hasStoredCurve(page)).toBe(false);

  // The first handle sits low-left for the default easing; haul it upward.
  await dragHandle(page, { fx: 0.42, fy: 0.72 }, { fx: 0.25, fy: 0.12 });

  expect(
    await hasStoredCurve(page),
    "the drag never reached the project",
  ).toBe(true);
  // Dragged high enough to overshoot, which no named easing can produce.
  expect((await readoutCurve(page))[1]!).toBeGreaterThan(0.5);
});

test("a drag is one Undo, not one per pointer move", async ({ page }) => {
  await animatedClip(page);
  await openCurve(page);
  await dragHandle(page, { fx: 0.42, fy: 0.72 }, { fx: 0.25, fy: 0.12 });
  expect(await hasStoredCurve(page)).toBe(true);

  await page.click("#btn-undo");
  await page.waitForTimeout(600);

  // A single Undo must clear the whole drag. If each pointermove committed, the
  // curve would still be there, a few pixels back along the path.
  expect(await hasStoredCurve(page)).toBe(false);
});

test("'Use named easing' removes the curve", async ({ page }) => {
  // The case the reducer got wrong: it spread the previous keyframe, so a curve
  // once set could never be taken off again.
  await animatedClip(page);
  await openCurve(page);
  await dragHandle(page, { fx: 0.42, fy: 0.72 }, { fx: 0.25, fy: 0.12 });
  expect(await hasStoredCurve(page)).toBe(true);

  await page.getByRole("button", { name: "Use named easing" }).click();
  await page.waitForTimeout(600);

  expect(await hasStoredCurve(page)).toBe(false);
});

test("choosing a named easing from the dropdown also discards the curve", async ({
  page,
}) => {
  // A curve supersedes the named easing, so leaving it in place would make the
  // dropdown appear to do nothing at all.
  await animatedClip(page);
  await openCurve(page);
  await dragHandle(page, { fx: 0.42, fy: 0.72 }, { fx: 0.25, fy: 0.12 });
  expect(await hasStoredCurve(page)).toBe(true);

  await page
    .locator(SCALE)
    .getByRole("combobox", { name: /keyframe easing/ })
    .selectOption("linear");
  await page.waitForTimeout(600);

  expect(await hasStoredCurve(page)).toBe(false);
});

test("the curve survives changing the keyframe's value", async ({ page }) => {
  // Editing the value must not silently throw away a curve the user drew.
  await animatedClip(page);
  await openCurve(page);
  await dragHandle(page, { fx: 0.42, fy: 0.72 }, { fx: 0.25, fy: 0.12 });
  expect(await hasStoredCurve(page)).toBe(true);
  const drawn = await readoutCurve(page);

  const slider = page.locator(SCALE).getByRole("slider", {
    name: /animation value/,
  });
  await slider.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = String(Number(input.value) + 0.1);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(600);

  expect(await hasStoredCurve(page)).toBe(true);
  expect(await readoutCurve(page)).toEqual(drawn);
});
