import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2025-01-01",
        d1Databases: ["DB"],
        bindings: { API_TOKEN: "test-token" },
      },
    }),
  ],
});
