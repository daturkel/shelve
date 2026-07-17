import { test, expect } from "./fixtures";

test("creates a folder and a link, and both survive a reload", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab/index.html`);

  await page.click(".new-folder-btn");
  await page.fill(".modal-input", "Reading List");
  await page.click(".modal-btn-primary");
  await expect(page.locator(".folder-name")).toHaveText("Reading List");

  await page.click(".entry-add-link");
  await page.fill(".modal-input", "example.com");
  await page.click(".modal-btn-primary");
  // The title prompt only appears if link-metadata fetch didn't resolve a
  // title itself (network-dependent in a real browser) — handle both.
  const titlePrompt = page.locator(".modal-input");
  if (await titlePrompt.isVisible().catch(() => false)) {
    await titlePrompt.fill("Example Site");
    await page.click(".modal-btn-primary");
  }
  await expect(page.locator(".entry:not(.entry-add-link)")).toHaveCount(1);

  await page.reload({ waitUntil: "load" });
  await expect(page.locator(".folder-name")).toHaveText("Reading List");
  await expect(page.locator(".entry:not(.entry-add-link)")).toHaveCount(1);
});
