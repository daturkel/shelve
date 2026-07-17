// Shared Playwright fixtures for the extension's e2e smoke suite: launches
// the real built extension (extension/dist) unpacked into a persistent
// Chromium context, same technique as the manual REPL driver at
// .claude/skills/run-extension/driver.mjs, but wired into the
// @playwright/test runner instead of a REPL loop.
import { test as base, chromium, type BrowserContext } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const DIST_DIR = path.resolve(import.meta.dirname, "../dist");

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright's fixture API requires this destructuring shape.
  context: async ({}, use, testInfo) => {
    if (!fs.existsSync(path.join(DIST_DIR, "manifest.json"))) {
      throw new Error("extension/dist/manifest.json missing — run `npm run build --workspace=extension` first");
    }
    // Headless (including the "new" headless architecture) doesn't
    // reliably register the extension's MV3 service worker, which the
    // extensionId fixture below depends on — same finding as the REPL
    // driver. Must run headed, which means CI needs a virtual display
    // (xvfb) since GitHub Actions runners have no real one.
    const context = await chromium.launchPersistentContext(testInfo.outputPath("profile"), {
      headless: false,
      args: [`--disable-extensions-except=${DIST_DIR}`, `--load-extension=${DIST_DIR}`],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let id: string | null = null;
    for (let i = 0; i < 30 && !id; i++) {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
      if (worker) id = worker.url().match(/^chrome-extension:\/\/([^/]+)\//)?.[1] ?? null;
      if (!id) await new Promise((r) => setTimeout(r, 200));
    }
    if (!id) throw new Error("could not determine extension id — service worker never registered");
    await use(id);
  },
});

export const expect = test.expect;
