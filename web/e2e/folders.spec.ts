import { test, expect } from "@playwright/test";

test("creates a folder and a link, and both survive a reload", async ({ page }) => {
  await page.goto("/");

  await page.click(".new-folder-btn");
  await page.fill(".modal-input", "Reading List");
  await page.click(".modal-btn-primary");
  await expect(page.locator(".folder-name")).toHaveText("Reading List");

  await page.click(".entry-add-link");
  await page.fill(".modal-input", "example.com");
  await page.click(".modal-btn-primary");
  // Unlike the extension (which bypasses CORS via manifest.json's
  // host_permissions), a plain web page can never successfully fetch an
  // arbitrary external site's <title> — core/lib/linkMetadata.ts's fetch
  // always fails here and falls back to a second manual title prompt.
  // Wait for whichever actually happens rather than racing the async
  // fetch-then-fallback timing with an immediate, non-waiting check.
  const titlePrompt = page.locator(".modal-input");
  const entryCreated = page.locator(".entry:not(.entry-add-link)");
  await expect(titlePrompt.or(entryCreated).first()).toBeVisible();
  if (await titlePrompt.isVisible()) {
    await titlePrompt.fill("Example Site");
    await page.click(".modal-btn-primary");
  }
  await expect(page.locator(".entry:not(.entry-add-link)")).toHaveCount(1);

  await page.reload({ waitUntil: "load" });
  await expect(page.locator(".folder-name")).toHaveText("Reading List");
  await expect(page.locator(".entry:not(.entry-add-link)")).toHaveCount(1);
});
