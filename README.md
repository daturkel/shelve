# Tab Sync

A self-hosted alternative to Toby: a Chrome extension for saving tabs into
folders, synced across your devices via your own Cloudflare Worker + D1
database.

Built because Toby's tab-sync has a size limit that's easy to hit if you save
a lot of tabs. This project has no such ceiling — you own the backend.

## How it works

- **Extension** (Manifest V3): save tabs into folders from a toolbar popup or
  the full folder browser (also your new tab page). Tabs stay open when
  saved — this is a bookmark manager, not a tab suspender.
- **Backend**: a small Cloudflare Worker + D1 (SQLite) database that you
  deploy to your own Cloudflare account. Free tier is more than enough for
  personal use.
- Each deployment is single-user (your own devices), authenticated with a
  single secret token you generate — no accounts system.

## Status

Early scaffolding — not yet functional. See `worker/` and `extension/` as
they're built out.

## Setup

_Coming soon: Wrangler CLI walkthrough for deploying your own Worker + D1,
and instructions for loading the extension unpacked._

## License

MIT — see [LICENSE](LICENSE).
