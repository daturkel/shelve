import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", ".wrangler/**", "assets/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Non-type-checked linting (no per-workspace tsconfig `project`
      // wiring here) — tsc --noEmit already runs separately in
      // precommit/CI and catches everything type-level; this is just
      // fast structural/style linting on top.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // `interface X extends Y {}` is a real, common pattern for module
      // augmentation (see worker/src/env.d.ts's cloudflare:test typing) —
      // not the accidental-empty-type mistake this rule otherwise catches.
      "@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "with-single-extends" }],
    },
  },
  {
    // TypeScript files: no-undef is redundant with (and less accurate
    // than) tsc's own checking — it doesn't know each workspace's actual
    // ambient types (chrome, DOM, Cloudflare Workers globals), so left on
    // it just produces false positives for things tsc already validates
    // correctly.
    files: ["**/*.ts"],
    rules: {
      "no-undef": "off",
    },
  },
  {
    // Plain Node scripts (release tooling, the screenshot generator) —
    // genuinely need real globals declared, since nothing else type-checks
    // these.
    files: ["**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // These two also embed callbacks that Playwright serializes and runs
    // inside a real browser page (chrome.tabs.*, document, DOMParser), not
    // in this Node process — both sets of globals genuinely appear in the
    // same file, just in different logical scopes ESLint can't separate.
    files: ["extension/.claude/skills/run-extension/driver.mjs", "extension/scripts/generate-readme-screenshot.mjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, chrome: "readonly" },
    },
  },
  // Must be last: turns off any stylistic rules above that would
  // otherwise conflict with Prettier owning all formatting.
  eslintConfigPrettier,
);
