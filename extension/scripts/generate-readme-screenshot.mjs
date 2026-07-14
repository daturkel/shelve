#!/usr/bin/env node
// Generates the README's hero screenshot from a real running build of the
// extension, seeded with representative sample data. Re-run this
// (`npm run screenshot` from extension/) any time a UI change makes the
// README's screenshot go stale.
//
// Rebuilds the extension first, so this always reflects current source
// rather than a possibly-stale dist/. Sample folders/entries are seeded
// directly into chrome.storage.local (fast, deterministic), but each
// entry's title/favicon is fetched for real, inside the page, using the
// exact same logic as extension/src/lib/linkMetadata.ts (copied inline
// rather than imported, since this runs inside page.evaluate — no
// bundler step here to resolve a real import) — so the sample data looks
// exactly like what a real "Add link" would produce, not a fabrication.
//
// Must run headed, not headless: headless Chromium doesn't reliably
// register the extension's MV3 service worker, which extension-id
// discovery below depends on. On a display-less machine, run this whole
// script under `xvfb-run -a`.
//
// Usage: node scripts/generate-readme-screenshot.mjs

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const EXT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(EXT_ROOT, "..");
const DIST_DIR = path.join(EXT_ROOT, "dist");
const PROFILE_DIR = "/tmp/shelve-screenshot-profile";
const OUTPUT_PATH = path.join(REPO_ROOT, "assets", "screenshot.png");

// Real, representative links — organized the way an actual user's
// folders might be, not placeholder lorem-ipsum data.
const SAMPLE_DATA = [
  {
    folder: "Longreads",
    links: [
      "https://www.theverge.com/cs/features/717322/wikipedia-attacks-neutrality-history-jimmy-wales",
      "https://worksinprogress.co/issue/the-housing-theory-of-everything/",
      "https://www.nytimes.com/2026/02/06/books/mass-market-paperback-books.html",
      "https://thewalrus.ca/how-a-would-be-bomber-rebuilt-his-life/",
      "https://www.thedial.world/articles/news/issue-15/",
      "https://www.thedriftmag.com/what-was-the-ted-talk/",
      "https://www.technologyreview.com/2023/08/11/1077232/corporate-presentations-history/?truid=2241ff3899f9aadc2c943f2fe5d7c4d5",
    ],
  },
  {
    folder: "Technical",
    links: [
      "https://medium.com/@kevinjtech/what-actually-matters-in-production-ml-systems-not-what-interviews-tell-you-69bd674e6776",
      "https://medium.com/airbnb-engineering/transforming-location-retrieval-at-airbnb-a-journey-from-heuristics-to-reinforcement-learning-d33ffc4ddb8f",
      "https://netflixtechblog.medium.com/lessons-learnt-from-consolidating-ml-models-in-a-large-scale-recommendation-system-870c5ea5eb4a",
      "https://fergusfinn.com/blog/what-happens-when-you-run-a-gpu-kernel/",
      "https://stripe.com/blog/idempotency",
      "https://danluu.com/simple-architectures/",
      "https://www.figma.com/blog/how-figmas-multiplayer-technology-works/",
    ],
  },
];

async function main() {
  console.log("Building extension...");
  execSync("npm run build", { cwd: EXT_ROOT, stdio: "inherit" });

  if (!fs.existsSync(path.join(DIST_DIR, "manifest.json"))) {
    throw new Error("dist/manifest.json missing after build");
  }
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [`--disable-extensions-except=${DIST_DIR}`, `--load-extension=${DIST_DIR}`],
    viewport: { width: 960, height: 800 },
  });

  try {
    await new Promise((r) => setTimeout(r, 1000));
    const page = await context.newPage();

    let extensionId = null;
    for (let i = 0; i < 20 && !extensionId; i++) {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
      if (worker) extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)\//)?.[1] ?? null;
      if (!extensionId) await new Promise((r) => setTimeout(r, 200));
    }
    if (!extensionId) throw new Error("Could not determine extension id — service worker never registered");

    await page.goto(`chrome-extension://${extensionId}/newtab/index.html`, { waitUntil: "load" });

    console.log("Fetching real titles/favicons for sample links...");
    const seeded = await page.evaluate(async (folders) => {
      async function fetchLinkMetadata(url) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const res = await fetch(url, { signal: controller.signal });
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, "text/html");
          const title = doc.querySelector("title")?.textContent?.trim() || null;
          const iconHref = doc.querySelector('link[rel~="icon"]')?.getAttribute("href");
          const faviconUrl =
            iconHref && iconHref !== "data:,"
              ? new URL(iconHref, url).toString()
              : new URL("/favicon.ico", url).toString();
          return { title, faviconUrl };
        } catch {
          return { title: null, faviconUrl: null };
        } finally {
          clearTimeout(timeout);
        }
      }

      const now = Date.now();
      const workspace = {
        id: "ws-screenshot",
        name: "Home",
        position: 0,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
      const outFolders = [];
      const outEntries = [];

      for (let fi = 0; fi < folders.length; fi++) {
        const { folder: name, links } = folders[fi];
        const folderId = `folder-${fi}`;
        outFolders.push({
          id: folderId,
          workspace_id: workspace.id,
          name,
          position: fi,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        });

        const metas = await Promise.all(links.map((url) => fetchLinkMetadata(url)));
        links.forEach((url, ei) => {
          const meta = metas[ei];
          outEntries.push({
            id: `entry-${fi}-${ei}`,
            folder_id: folderId,
            url,
            title: meta.title,
            favicon_url: meta.faviconUrl,
            note: null,
            position: ei,
            created_at: now,
            updated_at: now,
            deleted_at: null,
          });
        });
      }

      const state = { workspaces: [workspace], folders: outFolders, entries: outEntries };
      await chrome.storage.local.set({ shelve_state: state });
      return { folders: outFolders.length, entries: outEntries.length };
    }, SAMPLE_DATA);
    console.log(`Seeded ${seeded.folders} folders, ${seeded.entries} entries.`);

    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(500);

    // Hide both sidebars for a clean, focused shot — just the folder grid.
    await page.click('[title="Toggle workspaces"]');
    await page.click('[title="Toggle open tabs"]');
    await page.waitForTimeout(300);

    // The page layout is full-height flex, so .folders is stretched to
    // fill the viewport regardless of how much it actually contains —
    // its own scrollHeight/clientHeight reflect that stretched box, not
    // the content. Measure the bottom edge of the last real folder
    // section instead, which does reflect where the content actually
    // ends, and shrink the viewport to fit that rather than leaving a
    // lot of empty space below a couple of sample folders.
    const contentHeight = await page.evaluate(() => {
      const last = document.querySelector(".folders")?.lastElementChild;
      return last ? Math.ceil(last.getBoundingClientRect().bottom) + 24 : 400;
    });
    await page.setViewportSize({ width: 960, height: Math.min(800, Math.max(300, contentHeight)) });
    await page.waitForTimeout(200);

    await page.screenshot({ path: OUTPUT_PATH });
    console.log("Saved screenshot to", OUTPUT_PATH);
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
