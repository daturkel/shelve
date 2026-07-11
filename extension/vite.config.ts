import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "src",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        newtab: resolve(__dirname, "src/newtab/index.html"),
        options: resolve(__dirname, "src/options/index.html"),
      },
    },
  },
});
