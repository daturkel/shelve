# Operations

Day-two questions for an already-deployed install: multiple devices, migrating from Toby, losing your token, revoking a device, and emergency recovery. For deploying or upgrading in the first place, see [SETUP.md](SETUP.md).

## How do multiple devices work?

Configure each device's client — extension, web app, or both — with the same Worker URL and API token (from `npm run setup`, or [SETUP.md](SETUP.md#1-deploy-the-backend-required)).
They'll sync through your one Worker + D1 deployment, regardless of which client(s) each device uses.

## Can I use Shelve from my phone or a non-Chrome browser?

Yes, via the web app ([SETUP.md, Option B](SETUP.md#option-b-web-app)) — deploy it once to Cloudflare Pages and it works from any modern browser, desktop or mobile.
It shares the same Worker and data as the extension; the extension itself stays Chrome-only (browser extensions aren't cross-platform).

## Can I migrate from Toby?

Yes — in either client's settings screen (the extension's options page, or the web app's gear icon), go to Data → **Import from Toby**, pointed at Toby's own JSON export (Toby: Settings → Data → Export → JSON).
You can also export back to Toby's format, or export/import a native Shelve backup for device migration or safekeeping.

## What if my Worker/D1 gets into a bad state, or I need an emergency restore?

Cloudflare D1 has built-in point-in-time recovery ("Time Travel") with no setup required — you can restore your database to any minute within the last 7 days (Workers Free) or 30 days (Workers Paid):

```bash
npx wrangler d1 time-travel info shelve-db
npx wrangler d1 time-travel restore shelve-db --timestamp="2026-07-01T12:00:00Z"
```

Note this restores the whole database in place — it's a genuine emergency-recovery tool, not a routine undo button.
Day-to-day, Shelve's own sync design already avoids destructive operations: deletes are soft (nothing is ever hard-deleted by normal use, aside from the deliberate, opt-in "permanently delete" action in the trash view) and syncing can only ever add or update data, never wipe it — see [ARCHITECTURE.md](ARCHITECTURE.md#sync-model) for why.

## What if I lose my API token?

Generate a new one and re-run `wrangler secret put API_TOKEN` on the Worker, then update it in each device's client (the extension's options page, or the web app's settings screen).
Your data in D1 is untouched — the token only gates access to it.

## How do I revoke API access (e.g. a lost or compromised device)?

There's only one shared `API_TOKEN` per deployment, not one per device, so revoking access means rotating that single secret — which immediately invalidates it everywhere, including your other devices:

```bash
openssl rand -hex 32
npx wrangler secret put API_TOKEN
```

Update the new token on every device you want to keep syncing.
Any device you don't update (the lost/compromised one) starts getting 401s and can no longer read or write your data.
There's no way to revoke just one device's access while leaving others on the old token — a real limitation of the single-shared-secret design, acceptable given the intended use case (your own personal devices, not a team).

## Can other people see or use my deployment?

Only if they have your Worker URL _and_ your API token.
There's no accounts system — it's designed for one person's own devices.
