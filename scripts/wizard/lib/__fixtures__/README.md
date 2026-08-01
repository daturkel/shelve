Fixtures for `parseWranglerJson.test.mjs`. `worker/package.json` pins an
exact `wrangler` version (no `^`) specifically so these fixtures stay
representative of what's actually installed.

**Before bumping the `wrangler` pin:** regenerate the non-adversarial
fixtures against the new version's real output and re-run
`npm run test:wizard`, e.g.:

```
node worker/node_modules/.bin/wrangler d1 list --json
node worker/node_modules/.bin/wrangler d1 create some-throwaway-db --json
```

Sanitize any account-identifying values (account IDs, emails, real
database UUIDs) out of the captured output before committing it — replace
them with placeholders like `00000000-0000-0000-0000-000000000001`, as the
existing fixtures do. If a real `wrangler d1 create` run was used, delete
the throwaway database afterward.

If parsing breaks against the new version's output, fix `parseWranglerJson`
(or its callers in `../setup.mjs`) before completing the bump.
