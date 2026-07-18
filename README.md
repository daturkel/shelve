# Shelve

[![CI](https://github.com/daturkel/shelve/actions/workflows/ci.yml/badge.svg)](https://github.com/daturkel/shelve/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/daturkel/shelve)](https://github.com/daturkel/shelve/releases)
[![License: MIT](https://img.shields.io/github/license/daturkel/shelve)](LICENSE)

![Shelve's folder browser, showing two folders of saved links](assets/screenshot.png)

A self-hosted tab/link organizer, synced across your devices via a Cloudflare Worker + D1 database that **you** deploy and own.
The Worker + D1 backend is the one required piece; on top of it, use a **Chrome extension**, a **responsive web app** (any browser, desktop or mobile), or both — they share the same data and sync through the same Worker.

No accounts system, no arbitrary size limits, and no third party (not even the developer) ever sees your data — it goes only to the Cloudflare account you configure.
(If you've used [Toby](https://www.gettoby.com/), the shape will be familiar — Shelve started as a self-hosted take on it, built after running into Toby's tab-sync size limit.)

## What it does

- **Save tabs into folders** from a full-page folder browser (also your new tab page, optionally) or the toolbar popup — save the current tab, save every tab in the window, or drag a tab in from the live "open tabs" panel. _(Extension only — these need real browser-extension access.)_
  Saving is non-destructive: the original tab stays open.
- **Browse and organize from any browser**, including your phone, via the web app — create/rename/delete/move folders and links, search, trash/restore. Drag-and-drop reordering isn't built for it yet (see [KNOWN_GAPS.md](KNOWN_GAPS.md)).
- **Sync across your devices** through your own Worker + D1 backend.
  Last-write-wins on conflicts; deletes are soft (nothing is destroyed by a sync, ever — see [ARCHITECTURE.md](ARCHITECTURE.md) for why).
- **Organize** with workspaces → folders → entries, drag-and-drop reordering (extension), rename, search, and collapsible folders.
- **Import/export your data** as a JSON backup, or migrate to/from Toby if you're coming from (or trying out) it.

## Status

Functional, pre-1.0.
The core save/sync/organize workflow works end-to-end and is unit- and integration-tested on both the extension and the optional web app; a few nice-to-haves (tags, hard-deleting from trash, drag-and-drop reordering and PWA installability on the web app) are still open — see [KNOWN_GAPS.md](KNOWN_GAPS.md).

## Setup

One required piece — a Cloudflare Worker + D1 database, the sync backend, deployed to _your_ Cloudflare account — plus whichever client(s) you actually want to use on top of it: the Chrome extension, the web app, or both. Neither client depends on the other; pick what fits how you browse.

Prerequisites: [Node.js](https://nodejs.org/) 20 or later (an LTS release recommended — this repo was built against Node 24), and a [Cloudflare account](https://dash.cloudflare.com/sign-up) (the free tier is more than sufficient for personal use).

```bash
npm install
npm run setup
```

An interactive wizard that deploys the Worker + D1 backend and, optionally, the web app. It prints every command before running it and asks for confirmation first, so nothing happens without your say-so, and it's safe to re-run if you stop partway through — it detects what's already done. Chrome extension setup is still a manual browser step (`chrome://extensions` → Load unpacked) that the wizard prints instructions for at the end.

Prefer doing it by hand, or want to know what the wizard is actually doing? See [MANUAL_SETUP.md](MANUAL_SETUP.md).

### Upgrading

```bash
npm run upgrade
```

Same idea: an interactive wizard that applies any new migrations, redeploys the Worker, and optionally redeploys the web app if you set it up via the wizard — printing and confirming each command first, and printing instructions for updating the extension (a manual step) at the end. See [MANUAL_SETUP.md](MANUAL_SETUP.md#upgrading) for the equivalent by-hand steps.

## FAQ

**What is Wrangler?**
Cloudflare's official CLI for developing and deploying Workers, D1 databases, Pages, and the rest of the Cloudflare developer platform.
`npm run setup`/`npm run upgrade` drive it for you; every command in [MANUAL_SETUP.md](MANUAL_SETUP.md) uses it directly via `npx wrangler ...`, which runs the version pinned in `worker/package.json` on the fly (npm workspaces hoist it repo-wide, so this works the same from `web/` as it does from `worker/`) — you never install anything globally just to deploy Shelve.

**Should I install Node.js globally or per-user?**
Either works, but a per-user install is generally the better default if you do any other JS/TS development: a [version manager](https://github.com/nvm-sh/nvm) (nvm, fnm, volta, etc.) installs Node under your home directory, needs no `sudo`, and lets you switch Node versions per project.
A global/system install (the official installer, or a package manager like Homebrew) is simpler for a single-purpose machine, but can require elevated permissions for global npm installs and only lets you have one Node version at a time.
This repo doesn't care which you use, only that `node`/`npm` end up on your `PATH`.

**Is my data private?**
Yes — it lives only in the D1 database in your own Cloudflare account.
Nothing is sent anywhere else, and the developer has no access to it.

**What does this cost?**
Cloudflare's free tier (100k Worker requests/day, 5GB D1 storage) comfortably covers personal use.
Realistically, $0/month.

**How do multiple devices work?**
Configure each device's client — extension, web app, or both — with the same Worker URL and API token (from `npm run setup`, or [MANUAL_SETUP.md](MANUAL_SETUP.md#3-set-up-a-client--pick-one-or-both)).
They'll sync through your one Worker + D1 deployment, regardless of which client(s) each device uses.

**Can I use Shelve from my phone or a non-Chrome browser?**
Yes, via the web app ([MANUAL_SETUP.md, Option B](MANUAL_SETUP.md#option-b-web-app)) — deploy it once to Cloudflare Pages and it works from any modern browser, desktop or mobile.
It shares the same Worker and data as the extension; the extension itself stays Chrome-only (browser extensions aren't cross-platform).

**Can I migrate from Toby?**
Yes — in either client's settings screen (the extension's options page, or the web app's gear icon), go to Data → **Import from Toby**, pointed at Toby's own JSON export (Toby: Settings → Data → Export → JSON).
You can also export back to Toby's format, or export/import a native Shelve backup for device migration or safekeeping.

**What if my Worker/D1 gets into a bad state, or I need an emergency restore?**
Cloudflare D1 has built-in point-in-time recovery ("Time Travel") with no setup required — you can restore your database to any minute within the last 7 days (Workers Free) or 30 days (Workers Paid):

```bash
npx wrangler d1 time-travel info shelve-db
npx wrangler d1 time-travel restore shelve-db --timestamp="2026-07-01T12:00:00Z"
```

Note this restores the whole database in place — it's a genuine emergency-recovery tool, not a routine undo button.
Day-to-day, Shelve's own sync design already avoids destructive operations: deletes are soft (nothing is ever hard-deleted by normal use) and syncing can only ever add or update data, never wipe it — see [ARCHITECTURE.md](ARCHITECTURE.md#sync-model) for why.

**What if I lose my API token?**
Generate a new one and re-run `wrangler secret put API_TOKEN` on the Worker, then update it in each device's client (the extension's options page, or the web app's settings screen).
Your data in D1 is untouched — the token only gates access to it.

**How do I revoke API access (e.g. a lost or compromised device)?**
There's only one shared `API_TOKEN` per deployment, not one per device, so revoking access means rotating that single secret — which immediately invalidates it everywhere, including your other devices:

```bash
openssl rand -hex 32
npx wrangler secret put API_TOKEN
```

Update the new token on every device you want to keep syncing.
Any device you don't update (the lost/compromised one) starts getting 401s and can no longer read or write your data.
There's no way to revoke just one device's access while leaving others on the old token — a real limitation of the single-shared-secret design, acceptable given the intended use case (your own personal devices, not a team).

**Can other people see or use my deployment?**
Only if they have your Worker URL _and_ your API token.
There's no accounts system — it's designed for one person's own devices.

## How it's built

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data model, sync design, and repo layout.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
For things that are missing or incomplete, see [KNOWN_GAPS.md](KNOWN_GAPS.md).
For cutting a release or updating the README's screenshot, see [RELEASING.md](RELEASING.md).

## License

MIT — see [LICENSE](LICENSE).
