# Releasing Know It

Run these in order, every release.

## 1. Update the changelog

Add the new version at the top of [`CHANGELOG.md`](CHANGELOG.md):

```md
## 1.2.0 — A few words on what's new

New

- …
```

The words after the dash become the release title (`v1.2.0 — A few words on what's new`). Merge it to `main` through a pull request.

## 2. Release from `main`

```sh
git checkout main && git pull
npm run release -- 1.2.0 --dry-run   # builds know-it.zip and prints the notes, publishes nothing
npm run release -- 1.2.0
```

The script:

1. Refuses to run off `main`, with uncommitted changes, or for a version that is already tagged.
2. Sets the version in `package.json` and `public/manifest.json`.
3. Runs the type check, unit tests and docs check, then builds `know-it.zip`.
4. Commits the version bump, tags `v1.2.0`, pushes both, and creates the GitHub release with the zip and that version's changelog.

Commit as Arpit Agarwal only, with no co-author trailers or tool attribution.

## 3. Publish to the Chrome Web Store

Upload `know-it.zip` in the [developer dashboard](https://chrome.google.com/webstore/devconsole). [`store/listing.md`](store/listing.md) has the text for each tab, and `npm run store-screenshots` refreshes the screenshots in `store/screenshots`.

If the release changes what is sent to Google or kept in the browser, update [`store/privacy-policy.md`](store/privacy-policy.md) and the privacy tab of the listing first.

## Fixes without a release

[`remote-config.json`](remote-config.json) on `main` is read by every install once a day. Use it to change the models, YouTube selectors, links or the panel notice when YouTube or Gemini changes. Anything else needs a release.
