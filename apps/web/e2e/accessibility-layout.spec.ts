import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { importMedia } from "./helpers.js";

/**
 * Layout under pressure, and reach without a mouse.
 *
 * Both were unverified. The three-column workspace took every pixel it needed
 * out of the middle, so at 768px the stage — the panel the work actually
 * happens in — was a 110px sliver with two full-width sidebars beside it. And
 * only four components styled a focus ring, so a keyboard user tabbing through
 * the toolbar saw nothing at all against these panel colours.
 */

/** Stage width as a fraction of the viewport. */
async function stageShare(page: Page): Promise<number> {
  return page.evaluate(() => {
    const stage = document.getElementById("stage")!.getBoundingClientRect();
    return stage.width / window.innerWidth;
  });
}

const overflows = (page: Page): Promise<boolean> =>
  page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
  [1024, 800],
  [768, 900],
] as const) {
  test(`the stage stays usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await importMedia(page, "photos/colour-chart-512x512.jpg");

    expect(await overflows(page)).toBe(false);
    // Half the window at every size: below 1000px the layout stacks and the
    // stage takes the full width rather than being squeezed between sidebars.
    expect(await stageShare(page)).toBeGreaterThan(0.5);
  });
}

test("the stage comes first once the layout stacks", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await importMedia(page, "photos/colour-chart-512x512.jpg");

  const order = await page.evaluate(() => {
    const top = (id: string): number =>
      document.getElementById(id)!.getBoundingClientRect().top;
    return {
      stage: top("center-panel"),
      media: top("left-panel"),
      inspector: top("right-panel"),
    };
  });
  expect(order.stage).toBeLessThan(order.media);
  expect(order.stage).toBeLessThan(order.inspector);
});

test("keyboard focus is visible on the controls a mouse would use", async ({
  page,
}) => {
  await importMedia(page, "photos/colour-chart-512x512.jpg");

  const ring = async (): Promise<{ tag: string; width: string }> =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = getComputedStyle(el);
      return { tag: el.tagName, width: style.outlineWidth };
    });

  // Tab through the first controls of the toolbar; each stop must show a ring.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    const focused = await ring();
    if (focused.tag === "BODY") continue;
    expect(
      parseFloat(focused.width),
      `${focused.tag} at tab stop ${i + 1}`,
    ).toBeGreaterThan(0);
  }
});

test("motion is dropped when the system asks for less of it", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await importMedia(page, "photos/colour-chart-512x512.jpg");

  // Previously only the mode wheel honoured the preference; every other
  // transition kept running.
  const durations = await page.evaluate(() =>
    ["btn-export", "mode-wheel-drum", "stage"].map((id) => {
      const el = document.getElementById(id);
      return el ? getComputedStyle(el).transitionDuration : "0s";
    }),
  );
  for (const duration of durations) {
    expect(parseFloat(duration)).toBeLessThan(0.05);
  }
});
