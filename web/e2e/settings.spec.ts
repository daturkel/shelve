import { test, expect } from "@playwright/test";

test("opens the settings view via the gear icon and navigates back", async ({ page }) => {
  await page.goto("/");
  await page.click('[title="Settings"]');
  await expect(page.locator(".settings h1")).toHaveText("Settings");

  await page.click(".back-btn");
  await expect(page.locator(".toolbar")).toBeVisible();
});

test("theme toggle in settings applies immediately", async ({ page }) => {
  await page.goto("/");
  await page.click('[title="Settings"]');

  await page.click(".theme-toggle-btn:has-text('Light')");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.click(".theme-toggle-btn:has-text('Dark')");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
