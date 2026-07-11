import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        main: "./src/index.ts",
        miniflare: {
          compatibilityDate: "2025-01-01",
          d1Databases: ["DB"],
          bindings: { API_TOKEN: "test-token" },
        },
      },
    },
  },
});
