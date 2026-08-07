import { expect, test } from "@playwright/test";
import { MEDIA } from "./helpers.js";

test("media can be rated, searched, filtered, and restored with Undo", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.setInputFiles("#file-input", [
    MEDIA + "photos/colour-chart-512x512.jpg",
    MEDIA + "photos/gradient-landscape-1600x900.png",
  ]);
  await expect(page.locator(".media-item")).toHaveCount(2, {
    timeout: 30_000,
  });

  await page
    .getByRole("button", { name: "Favorite colour-chart-512x512.jpg" })
    .click();
  await expect(
    page.getByRole("button", { name: "Favorite colour-chart-512x512.jpg" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByLabel("Media filter").selectOption("favorites");
  await expect(page.locator(".media-item")).toHaveCount(1);
  await expect(page.locator(".media-name")).toHaveText(
    "colour-chart-512x512.jpg",
  );

  await page.getByLabel("Media filter").selectOption("all");
  await page.getByLabel("Search media").fill("gradient");
  await expect(page.locator(".media-item")).toHaveCount(1);
  await expect(page.locator(".media-name")).toHaveText(
    "gradient-landscape-1600x900.png",
  );
  await page.getByLabel("Search media").fill("");

  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByLabel("Media filter").selectOption("favorites");
  await expect(page.locator(".media-item")).toHaveCount(0);
  await expect(page.locator("#media-empty")).toContainText("No media matches");
});
