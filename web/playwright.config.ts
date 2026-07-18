import { defineConfig } from "@playwright/test";

// Unlike the extension's e2e suite (which needs a persistent context
// loading an unpacked extension into headed Chromium under xvfb), a
// plain web page needs none of that — Playwright's built-in webServer
// starts/tears down a preview server automatically, and headless
// Chromium works fine.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
});
