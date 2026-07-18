// tsc/vitest operate on whole projects, not individual files, so every
// entry ignores the filenames lint-staged would otherwise append and just
// runs one command for the affected workspace(s). A change under shared/
// triggers both worker and extension, since both depend on it.
//
// ESLint/Prettier are the opposite — they're per-file tools, so those
// entries are plain strings and let lint-staged append the actual staged
// filenames (and re-stage whatever --fix/--write changes) itself.
export default {
  "shared/**/*.ts": () => [
    "npm run typecheck --workspace=worker",
    "npm run typecheck --workspace=core",
    "npm run typecheck --workspace=extension",
    "npm run test --workspace=worker",
    "npm run test --workspace=core",
    "npm run test --workspace=extension",
  ],
  "worker/**/*.ts": () => ["npm run typecheck --workspace=worker", "npm run test --workspace=worker"],
  // A change under core/ also re-checks extension, the only consumer.
  "core/**/*.ts": () => [
    "npm run typecheck --workspace=core",
    "npm run typecheck --workspace=extension",
    "npm run test --workspace=core",
    "npm run test --workspace=extension",
  ],
  "extension/**/*.ts": () => ["npm run typecheck --workspace=extension", "npm run test --workspace=extension"],
  "**/*.{ts,mjs}": ["eslint --fix", "prettier --write"],
  "**/*.{css,md,json,html}": "prettier --write",
};
