// Reads/writes worker/wrangler.toml with surgical regex replacements rather
// than a TOML parser dependency — the file's shape is fixed and small (see
// worker/wrangler.toml.example), the same tradeoff scripts/bump-version.mjs
// already makes for package.json's "version" field.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PLACEHOLDER_DATABASE_ID = "TODO_FILL_IN_AFTER_D1_CREATE";

function paths(root) {
  const worker = join(root, "worker");
  return {
    toml: join(worker, "wrangler.toml"),
    example: join(worker, "wrangler.toml.example"),
  };
}

/** Returns null if wrangler.toml doesn't exist yet at all. */
export function readWranglerToml(root) {
  const { toml } = paths(root);
  if (!existsSync(toml)) return null;

  const content = readFileSync(toml, "utf8");
  const name = content.match(/^name = "([^"]*)"/m)?.[1] ?? null;
  const databaseName = content.match(/database_name = "([^"]*)"/)?.[1] ?? null;
  const databaseId = content.match(/database_id = "([^"]*)"/)?.[1] ?? null;
  const configured = Boolean(databaseId) && databaseId !== PLACEHOLDER_DATABASE_ID;

  return { name, databaseName, databaseId, configured };
}

/** Copies wrangler.toml.example -> wrangler.toml if it doesn't exist yet,
 * then writes the given fields. Fields left undefined are untouched. */
export function writeWranglerToml(root, { name, databaseName, databaseId } = {}) {
  const { toml, example } = paths(root);
  if (!existsSync(toml)) copyFileSync(example, toml);

  let content = readFileSync(toml, "utf8");
  if (name !== undefined) content = content.replace(/^name = "[^"]*"/m, `name = "${name}"`);
  if (databaseName !== undefined)
    content = content.replace(/database_name = "[^"]*"/, `database_name = "${databaseName}"`);
  if (databaseId !== undefined) content = content.replace(/database_id = "[^"]*"/, `database_id = "${databaseId}"`);
  writeFileSync(toml, content);
}
