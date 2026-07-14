# Releasing

## Versioning

Root `package.json`'s `"version"` is the single source of truth.
It's hand-duplicated (deliberately — see `worker/src/version.ts`'s own comment for why there's no build-time step to derive it instead) into five other places:

- `shared/package.json`, `worker/package.json`, `extension/package.json`
- `extension/manifest.json`
- `worker/src/version.ts`'s `WORKER_VERSION` constant — what the Worker reports from `GET /health`, which the extension's options page compares against its own version to warn about a stale deployment

Bump all six at once with:

```bash
node scripts/bump-version.mjs 0.2.0   # no leading "v"
```

This only edits files — it doesn't commit anything.
Run it whenever, as a normal commit, independent of actually cutting a release.
Keeping it up to date during development (not just right before a release) is what lets the extension/Worker version-compatibility check mean anything day-to-day.

## Releasing

Once the version at the top of `CHANGELOG.md`'s `[Unreleased]` section is the one you want to ship:

```bash
node scripts/release.mjs
```

This reads whatever version is currently set (no argument — see Versioning above), and:

- Validates all six version locations actually agree, refusing to run if they don't (run `bump-version.mjs` first if it complains).
- Refuses to run if a `vX.Y.Z` tag for that version already exists.
- Promotes `CHANGELOG.md`'s `[Unreleased]` section to a dated `## [X.Y.Z] - YYYY-MM-DD` section, with a fresh empty `[Unreleased]` above it.

It only edits `CHANGELOG.md` — review the diff, then finish it by hand:

```bash
git add -A && git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```

Pushing the tag triggers `.github/workflows/release.yml`, which builds the extension and attaches a ready-to-load zip to a GitHub Release.
That workflow only builds and publishes — it doesn't touch versioning or the changelog, so the tag you push always exactly matches what `release.mjs` already committed.

This whole flow is deliberately local-first rather than triggered by CI: for a solo-maintained, low-cadence project, the convenience of skipping a few local commands isn't worth giving CI push/force-push access to `main` and tags, or committing an unreviewed version bump + changelog rewrite before a human has seen the diff.

## Updating the README's screenshot

```bash
cd extension
npm run screenshot
```

`extension/scripts/generate-readme-screenshot.mjs` rebuilds the extension, loads it into a real Chromium instance (same approach as the `run-extension` driver skill), and seeds a couple of sample folders of real links.
Title/favicon fetching runs the exact logic from `extension/src/lib/linkMetadata.ts` inside the page itself, so the sample entries look like whatever a real "Add link" would actually produce — including realistic fallbacks (bare domain, generic title) where a site blocks the fetch — rather than fabricated placeholder data.
It hides both the workspace rail and open-tabs panel and shrinks the viewport to fit the actual rendered content, then overwrites `assets/screenshot.png`, which the README embeds directly.

Re-run this any time a UI change makes the screenshot noticeably stale.
The sample links themselves are hardcoded in the script — edit the `SAMPLE_DATA` array there if you want different ones.
