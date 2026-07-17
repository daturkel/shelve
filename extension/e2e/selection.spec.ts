import { test, expect } from "./fixtures";

async function addLink(page: import("@playwright/test").Page, url: string): Promise<void> {
  await page.click(".entry-add-link");
  await page.fill(".modal-input", url);
  await page.click(".modal-btn-primary");
  const titlePrompt = page.locator(".modal-input");
  if (await titlePrompt.isVisible().catch(() => false)) {
    await page.click(".modal-btn-primary");
  }
}

test("multi-select shows an action bar and deletes the selection", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab/index.html`);

  await page.click(".new-folder-btn");
  await page.fill(".modal-input", "Links");
  await page.click(".modal-btn-primary");

  await addLink(page, "example.com");
  await addLink(page, "example.org");
  await expect(page.locator(".entry:not(.entry-add-link)")).toHaveCount(2);

  // The checkbox shares the favicon's hover-reveal slot (opacity 0 /
  // pointer-events none until hover or selected), so a plain click isn't
  // actionable in Playwright's eyes — force it, matching how a real
  // hover-then-click would land on it.
  const checkboxes = page.locator(".entry-checkbox");
  await checkboxes.nth(0).click({ force: true });
  await checkboxes.nth(1).click({ force: true });

  await expect(page.locator(".entry-selection-count")).toHaveText("2 selected");

  await page.click(".entry-selection-btn-danger");
  await page.click(".modal-btn-danger");

  await expect(page.locator(".entry:not(.entry-add-link)")).toHaveCount(0);
  await expect(page.locator(".entry-selection-bar")).toHaveCount(0);
});
