# Manual setup & upgrading

Step-by-step instructions for deploying and upgrading Shelve by hand, without the `npm run setup`/`npm run upgrade` wizards described in the [README](README.md#setup). Useful if you want to understand what the wizards are doing under the hood, prefer to run things yourself, or hit a case the wizards don't handle.

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or later (an LTS release recommended — this repo was built against Node 24)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (the free tier is more than sufficient for personal use)

## 1. Install dependencies

From the repo root:

```bash
npm install
```

## 2. Deploy the backend

```bash
cd worker
npx wrangler login          # opens a browser to authorize Wrangler
npx wrangler d1 create shelve-db    # name it whatever you like
```

Copy `wrangler.toml.example` to `wrangler.toml`, and paste in the `database_id` that `d1 create` just printed.
You can also rename `name` (the Worker) and `database_name` (the D1 database) to anything you want — they're just labels in your own account, nothing else depends on the specific strings `shelve-worker`/`shelve-db`.

```bash
cp wrangler.toml.example wrangler.toml
# edit wrangler.toml: paste in database_id, optionally rename name/database_name

npx wrangler d1 migrations apply shelve-db --remote   # apply the schema

# generate a random token, then paste it when `secret put` prompts:
openssl rand -hex 32
npx wrangler secret put API_TOKEN

npx wrangler deploy
```

`wrangler deploy` prints your Worker's live URL (`https://<your-worker-name>.<your-subdomain>.workers.dev`) — save it, you'll need it in step 3.
Save the `API_TOKEN` value too (e.g. in a password manager) — it's a write-only secret in Cloudflare, there's no way to read it back later.

## 3. Set up a client — pick one or both

Both talk to the same Worker from step 2 and share the same data; neither depends on the other being set up.

### Option A: Chrome extension

No Chrome Web Store listing yet — load it unpacked.
Either build it yourself:

```bash
cd extension   # from the repo root
npm run build
```

...or skip building entirely: grab the latest `shelve-extension-vX.Y.Z.zip` from [Releases](https://github.com/daturkel/shelve/releases) and unzip it.

Then in Chrome: `chrome://extensions` → enable **Developer mode** (top right) → **Load unpacked** → select `extension/dist` (or the folder you just unzipped).

**Configure sync:** click the Shelve toolbar icon → the gear icon (or right-click the extension icon → **Options**). Enter the Worker URL and API token from step 2, click **Save** — it'll confirm the connection and tell you if it found existing data.

### Option B: Web app

A responsive folder browser for any browser, desktop or mobile, deployed as static files to [Cloudflare Pages](https://pages.cloudflare.com/) via the same Wrangler CLI as step 2. No environment variables needed at build time — the Worker URL and API token are entered in the deployed app itself (its own gear-icon settings screen, same idea as the extension's options page).

```bash
cd web   # from the repo root
npm run build
npx wrangler pages deploy dist --project-name=shelve-web   # name it whatever you like; first run prompts to create the project
```

Open the printed Pages URL, go to Settings, and enter the same Worker URL/token from step 2.

Re-run the same `wrangler pages deploy` command any time you want to push a new build — nothing auto-deploys on its own.

The web app's data is local-first (stored in the browser's IndexedDB, same architecture as the extension's `chrome.storage.local`) and syncs through your Worker exactly like another device — see [KNOWN_GAPS.md](KNOWN_GAPS.md) for what's different from the extension (no drag-and-drop reordering yet, no offline/installable PWA support yet).

## Upgrading

The Worker and each client are versioned together but deployed independently — you update each by hand, on your own schedule, so they can never be assumed to be in lock-step. Update the Worker first, then whichever client(s) you have set up:

```bash
cd worker   # from the repo root
npx wrangler d1 migrations apply shelve-db --remote   # applies any new migrations; a no-op if there aren't any
npx wrangler deploy
```

`wrangler d1 migrations apply` only runs migrations it hasn't already recorded as applied, so it's safe to run on every upgrade whether or not that particular update actually changed the schema.
If you ever do update a client before the Worker, it'll show a clear warning ("Worker: vX.Y.Z — its schema is out of date") and sync pauses itself rather than risk losing data against a schema the Worker doesn't have yet — running the command above clears it.

**Extension:**

```bash
cd extension   # from the repo root
npm run build
```

(Or download the new version's zip from [Releases](https://github.com/daturkel/shelve/releases) instead of building it yourself — same as initial setup.)
Then reload the extension from `chrome://extensions` (the circular reload icon on Shelve's card, or **Remove** + **Load unpacked** again if you switched to a freshly-unzipped folder) — unpacked extensions don't auto-reload on file or folder changes, and there's no Chrome Web Store listing yet to update it for you automatically.

**Web app:** re-run the same deploy command from step 3:

```bash
cd web   # from the repo root
npm run build
npx wrangler pages deploy dist --project-name=shelve-web
```

It also needs a Worker that includes CORS support, added in the same release as the web app itself — a normal `npx wrangler deploy` upgrade already covers this as long as you've redeployed since then. A Worker predating that will reject every request from the web app with an opaque network error rather than a readable one, since it never sends the headers a browser requires for a cross-origin request in the first place.
