# Setup

Deploying and upgrading Shelve — the wizard-driven path and the by-hand equivalent, side by side. Both end up in the same place; start with the wizard and drop to manual commands if it hits a case it doesn't handle (see [KNOWN_GAPS.md](KNOWN_GAPS.md)).

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (the free tier is enough for personal use)

## 0. Get the code

```bash
git clone https://github.com/daturkel/shelve.git
cd shelve
git checkout vX.Y.Z   # replace with the latest tag from https://github.com/daturkel/shelve/releases
npm install
```

Check out a release tag rather than staying on `main`, which can be ahead of the last tagged release. See [RELEASING.md](RELEASING.md) for how tags get made.

## 1. Deploy the backend (required)

One Cloudflare Worker + one D1 database — the sync backend every client talks to. This piece is required; the two clients below are optional on top of it.

**Wizard:**

```bash
npm run wizard:deploy
```

Deploys the Worker + D1 backend and, optionally, the web app and the Chrome extension build. The same command handles both first-time setup and later upgrades — it adapts to whatever's already there rather than needing you to pick the right script. Read-only lookups (checking what already exists) never ask for confirmation; each phase's actual changes are grouped into one plan you confirm once. Safe to re-run if you stop partway through — it detects what's already done. See [Flags](#flags) below for non-interactive/scripted use. The Chrome extension's own installation is still a manual browser step either way (see Option A below) — the wizard can build it for you, but can't load it into Chrome.

**By hand:**

```bash
cd worker
npx wrangler login          # opens a browser to authorize Wrangler
npx wrangler d1 create shelve-db    # name it whatever you like
```

Copy `wrangler.toml.example` to `wrangler.toml`, and paste in the `database_id` that `d1 create` just printed. You can rename `name` (the Worker) and `database_name` (the D1 database) too — they're just labels in your own account.

```bash
cp wrangler.toml.example wrangler.toml
# edit wrangler.toml: paste in database_id, optionally rename name/database_name

npx wrangler d1 migrations apply shelve-db --remote   # apply the schema

# generate a random token, then paste it when `secret put` prompts:
openssl rand -hex 32
npx wrangler secret put API_TOKEN

npx wrangler deploy
```

`wrangler deploy` prints your Worker's live URL (`https://<your-worker-name>.<your-subdomain>.workers.dev`) — save it, you'll need it next. Save the `API_TOKEN` value too (e.g. in a password manager); it's write-only in Cloudflare, there's no way to read it back later.

## 2. Set up a client — pick one or both

Both talk to the same Worker from step 1 and share the same data; neither depends on the other.

### Option A: Chrome extension

No Chrome Web Store listing yet — load it unpacked. If you used the wizard and didn't say `--no-extension`, `extension/dist` is already built. Otherwise, build it yourself:

```bash
cd extension   # from the repo root
npm run build
```

...or grab the latest `shelve-extension-vX.Y.Z.zip` from [Releases](https://github.com/daturkel/shelve/releases) and unzip it. Either way, loading it into Chrome is a manual step the wizard can't automate — there's no CLI-drivable install path.

Then in Chrome: `chrome://extensions` → enable **Developer mode** (top right) → **Load unpacked** → select `extension/dist` (or the folder you unzipped).

**Configure sync:** click the Shelve toolbar icon → the gear icon (or right-click the extension icon → **Options**). Enter the Worker URL and API token from step 1 and click **Save** — it confirms the connection and tells you if it found existing data.

### Option B: Web app

A responsive folder browser for any browser, desktop or mobile, deployed as static files to [Cloudflare Pages](https://pages.cloudflare.com/) via the same Wrangler CLI as step 1. No build-time environment variables — the Worker URL and API token are entered in the deployed app's own settings screen.

If you used the wizard, this is already done. By hand:

```bash
cd web   # from the repo root
npm run build
npx wrangler pages deploy dist --project-name=shelve-web   # name it whatever you like
```

Open the printed Pages URL, go to Settings, and enter the same Worker URL/token from step 1.

Re-run the same `wrangler pages deploy` command any time you want to push a new build — nothing auto-deploys. Make sure the Pages project's production branch matches what you deploy from (Cloudflare dashboard → Pages → your project → Settings → Builds & deployments), or your stable `<project>.pages.dev` URL keeps serving whatever was last deployed to that branch instead of your latest build.

The web app's data is local-first (IndexedDB) and syncs through your Worker like another device — see [KNOWN_GAPS.md](KNOWN_GAPS.md) for what's different from the extension (no touch drag-and-drop, no PWA support yet).

## Upgrading

The Worker and each client are versioned together but deployed independently, updated by hand on your own schedule.

**Wizard:** just run `npm run wizard:deploy` again — it's the same command as first-time setup. Finding `worker/wrangler.toml` already configured, it applies any new migrations and redeploys the Worker, offers to redeploy the web app if you set it up via the wizard, and offers to rebuild the extension — no separate upgrade command to remember.

**By hand,** update the Worker first, then whichever client(s) you have set up:

```bash
cd worker   # from the repo root
npx wrangler d1 migrations apply shelve-db --remote   # a no-op if there's nothing new
npx wrangler deploy
```

If you update a client before the Worker, it shows a warning ("Worker: vX.Y.Z — its schema is out of date") and pauses sync until you run the command above.

**Extension:**

```bash
cd extension   # from the repo root
npm run build
```

(Or download the new version's zip from [Releases](https://github.com/daturkel/shelve/releases).) Then reload the extension from `chrome://extensions` — unpacked extensions don't auto-reload on file changes.

**Web app:** re-run the same deploy command from step 2:

```bash
cd web   # from the repo root
npm run build
npx wrangler pages deploy dist --project-name=shelve-web
```

This also needs a Worker with CORS support (added alongside the web app itself) — a normal `npx wrangler deploy` upgrade covers it as long as you've redeployed since then. An older Worker rejects every web app request with an opaque network error instead of a readable one.

## Flags

`npm run wizard:deploy` accepts flags after `--`, e.g. `npm run wizard:deploy -- --yes --database=shelve-db --worker-name=shelve-worker`:

| Flag                                   | Meaning                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--yes` / `-y`                         | Non-interactive. Every confirmation auto-accepts its own safe default (e.g. "rotate the token?" defaults to no). A choice with no safe default — which existing D1 database or Worker to use, when none is already configured locally — is never guessed; it fails immediately with a message naming the flag to supply instead. |
| `--dry-run`                            | Prints the plan for each phase without running anything. Combine with `--yes` to preview a fully non-interactive run.                                                                                                                                                                                                            |
| `--database=<name>`                    | Explicit D1 database name — reuses it if it already exists in your account, creates it if not. Required by `--yes` whenever `worker/wrangler.toml` isn't already configured.                                                                                                                                                     |
| `--worker-name=<name>`                 | Explicit Worker name. Required by `--yes` whenever `worker/wrangler.toml` isn't already configured. If a Worker already exists under this name, deploying redeploys over it — the wizard warns either way, and asks for confirmation unless `--yes` is set.                                                                      |
| `--pages-project=<name>`               | Explicit Cloudflare Pages project name. Required by `--yes` when deploying the web app and no project is already recorded in `.shelve/wizard.json`.                                                                                                                                                                              |
| `--web` / `--no-web`                   | Explicitly include or exclude the web app, instead of being asked. Under `--yes` with neither given, the web app is skipped (with a warning) rather than guessed at, since it needs a project name to resolve.                                                                                                                   |
| `--extension` / `--no-extension`       | Explicitly include or exclude building the extension, instead of being asked. Under `--yes` with neither given, it's built by default — unlike the web app, building it needs no account resource to resolve, so there's nothing to guess.                                                                                       |
| `--rotate-token` / `--no-rotate-token` | Explicit answer to "reconnecting to an existing database — rotate the API_TOKEN secret?" **Default is no** — rotating invalidates every already-configured client's token. Only relevant when reconnecting to an existing database; a brand-new database always gets a token generated (not a "rotation").                       |

`npm run wizard:status` takes no flags — it's always read-only.
