import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";

// Single SPA entry, unlike the extension's multi-page build — plain
// default Vite conventions apply (root-level index.html, dist/ output),
// no rollupOptions.input split or fixed-filename special-casing needed.
export default defineConfig({
  test: {
    // The extension avoids Vitest picking up its e2e/*.spec.ts files by
    // setting root: "src" in its own vite.config.ts, which puts e2e/ (a
    // sibling of src/) outside Vitest's discovery entirely. web/ has no
    // src-only root (its index.html is a normal root-level Vite entry),
    // so exclude e2e/ explicitly instead — Playwright's test() throws if
    // Vitest ever tries to import a *.spec.ts file directly.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
