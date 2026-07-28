# Setup

Deploying and upgrading Shelve — the wizard-driven path and the by-hand equivalent, side by side. Both end up in the same place; pick whichever you're more comfortable with, or start with the wizard and drop to the manual commands if it hits a case it doesn't handle (see [KNOWN_GAPS.md](KNOWN_GAPS.md) for what those are).

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or later (an LTS release recommended — this repo was built against Node 24)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (the free tier is more than sufficient for personal use)

## 0. Get the code

```bash
git clone https://github.com/daturkel/shelve.git
cd shelve
git checkout vX.Y.Z   # replace with the latest tag from https://github.com/daturkel/shelve/releases
npm install
```

Check out a release tag rather than staying on `main` — `main` can be ahead of the last tagged release (in-progress work, not yet cut). See [RELEASING.md](RELEASING.md) for how tags get made.

## 1. Deploy the backend (required)

One Cloudflare Worker + one D1 database — the sync backend every client talks to. This piece is required; the two clients below are both optional on top of it.

**Wizard:**

```bash
npm run setup
```

Deploys the Worker + D1 backend and, optionally, the web app. Prints every command before running it and asks for confirmation first, so nothing happens without your say-so — safe to re-run if you stop partway through, since it detects what's already done. Skip to step 3 for the Chrome extension (still a manual browser step either way).

**By hand:**

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

`wrangler deploy` prints your Worker's live URL (`https://<your-worker-name>.<your-subdomain>.workers.dev`) — save it, you'll need it in the next step.
Save the `API_TOKEN` value too (e.g. in a password manager) — it's a write-only secret in Cloudflare, there's no way to read it back later.

## 2. Set up a client — pick one or both

Both talk to the same Worker from step 1 and share the same data; neither depends on the other being set up.

### Option A: Chrome extension

No Chrome Web Store listing yet — load it unpacked.
Either build it yourself:

```bash
cd extension   # from the repo root
npm run build
```

...or skip building entirely: grab the latest `shelve-extension-vX.Y.Z.zip` from [Releases](https://github.com/daturkel/shelve/releases) and unzip it.

Then in Chrome: `chrome://extensions` → enable **Developer mode** (top right) → **Load unpacked** → select `extension/dist` (or the folder you just unzipped).

**Configure sync:** click the Shelve toolbar icon → the gear icon (or right-click the extension icon → **Options**). Enter the Worker URL and API token from step 1, click **Save** — it'll confirm the connection and tell you if it found existing data.

### Option B: Web app

A responsive folder browser for any browser, desktop or mobile, deployed as static files to [Cloudflare Pages](https://pages.cloudflare.com/) via the same Wrangler CLI as step 1. No environment variables needed at build time — the Worker URL and API token are entered in the deployed app itself (its own gear-icon settings screen, same idea as the extension's options page).

If you used the wizard, this is already done. By hand:

```bash
cd web   # from the repo root
npm run build
npx wrangler pages deploy dist --project-name=shelve-web   # name it whatever you like; first run prompts to create the project
```

Open the printed Pages URL, go to Settings, and enter the same Worker URL/token from step 1.

Re-run the same `wrangler pages deploy` command any time you want to push a new build — nothing auto-deploys on its own. Make sure the Pages project's **production branch** actually matches the branch/tag you deploy from (Cloudflare dashboard → Pages → your project → Settings → Builds & deployments) — otherwise your stable `<project>.pages.dev` URL silently keeps serving whatever was last deployed to the branch it's actually set to, not your latest deploy.

The web app's data is local-first (stored in the browser's IndexedDB, same architecture as the extension's `chrome.storage.local`) and syncs through your Worker exactly like another device — see [KNOWN_GAPS.md](KNOWN_GAPS.md) for what's different from the extension (drag-and-drop reordering works on desktop but not via touch yet, no offline/installable PWA support yet).

## Upgrading

The Worker and each client are versioned together but deployed independently — you update each by hand, on your own schedule, so they can never be assumed to be in lock-step.

**Wizard:**

```bash
npm run upgrade
```

Applies any new migrations, redeploys the Worker, and optionally redeploys the web app if you set it up via the wizard — printing and confirming each command first, and printing instructions for updating the extension (a manual step) at the end.

**By hand,** update the Worker first, then whichever client(s) you have set up:

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

**Web app:** re-run the same deploy command from step 2:

```bash
cd web   # from the repo root
npm run build
npx wrangler pages deploy dist --project-name=shelve-web
```

It also needs a Worker that includes CORS support, added in the same release as the web app itself — a normal `npx wrangler deploy` upgrade already covers this as long as you've redeployed since then. A Worker predating that will reject every request from the web app with an opaque network error rather than a readable one, since it never sends the headers a browser requires for a cross-origin request in the first place.
