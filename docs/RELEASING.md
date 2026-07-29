# Releasing

## Versioning

Root `package.json`'s `"version"` is the source of truth, hand-duplicated into five other places: `shared/package.json`, `worker/package.json`, `extension/package.json`, `extension/manifest.json`, and `worker/src/version.ts`'s `WORKER_VERSION` (what the Worker reports from `GET /health`, used to warn clients about a stale deployment).

Bump all six at once with:

```bash
node scripts/bump-version.mjs 0.2.0   # no leading "v"
```

This only edits files — it doesn't commit anything. Run it as its own commit whenever, independent of cutting a release; keeping it current is what makes the version-compatibility check meaningful day to day.

## Releasing

Once the version at the top of `CHANGELOG.md`'s `[Unreleased]` section is the one you want to ship:

```bash
node scripts/release.mjs
```

This reads the currently-set version (see Versioning above) and:

- Validates all six version locations agree, refusing to run if they don't (run `bump-version.mjs` first if it complains).
- Refuses to run if a `vX.Y.Z` tag for that version already exists.
- Promotes `CHANGELOG.md`'s `[Unreleased]` section to a dated `## [X.Y.Z] - YYYY-MM-DD` section, with a fresh empty `[Unreleased]` above it.

It only edits `CHANGELOG.md` — review the diff, then finish it by hand:

```bash
git add -A && git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```

Pushing the tag triggers `.github/workflows/release.yml`, which builds the extension and attaches a ready-to-load zip to a GitHub Release. That workflow only builds and publishes — it never touches versioning or the changelog.

This is local-first rather than CI-triggered: for a solo-maintained, low-cadence project, it's not worth giving CI push access to `main` and tags for the sake of skipping a few local commands.

## Updating the README's screenshot

```bash
cd extension
npm run screenshot
```

`extension/scripts/generate-readme-screenshot.mjs` rebuilds the extension, loads it into a real Chromium instance, seeds a couple of sample folders of real links, and overwrites `assets/screenshot.png`. Re-run it any time a UI change makes the screenshot stale. Sample links are hardcoded in the script's `SAMPLE_DATA` array.
