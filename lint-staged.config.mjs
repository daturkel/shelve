// tsc/vitest operate on whole projects, not individual files, so every
// entry ignores the filenames lint-staged would otherwise append and just
// runs one command for the affected workspace(s). A change under shared/
// triggers both worker and extension, since both depend on it.
export default {
  "shared/**/*.ts": () => [
    "npm run typecheck --workspace=worker",
    "npm run typecheck --workspace=extension",
    "npm run test --workspace=worker",
    "npm run test --workspace=extension",
  ],
  "worker/**/*.ts": () => ["npm run typecheck --workspace=worker", "npm run test --workspace=worker"],
  "extension/**/*.ts": () => [
    "npm run typecheck --workspace=extension",
    "npm run test --workspace=extension",
  ],
};
