# Contributing to Know It

Contributions are welcome: bug reports, ideas and pull requests. Before your contribution can be accepted, please read and agree to the contribution terms below.

## Development setup

Requires Node 22+ and Chrome.

```sh
npm install
npm run build
git config core.hooksPath .githooks
```

Load the `dist` folder from `chrome://extensions` with **Developer mode** on and **Load unpacked**. `npm run watch` rebuilds on every change; reload the extension to pick it up.

The last command turns on a **pre-push hook** that runs [`scripts/check-docs.mjs`](scripts/check-docs.mjs), a fast check that the docs stay in sync: the version matches in `package.json` and `public/manifest.json`, the changelog has that version, and internal links resolve. The same check runs in CI on every push and pull request. Bypass the hook in an emergency with `git push --no-verify`.

## Before you open a pull request

```sh
npm run typecheck
npm test
npm run check-docs
```

For anything that touches YouTube's pages, also run `npm run test:e2e`. It drives the extension on real YouTube with a mock Gemini and saves screenshots to `e2e/output`.

A few things to keep in mind:

- **Model output is untrusted.** Put it on the page with `textContent` or built elements, never as HTML.
- **YouTube changes its markup.** Selectors live in `src/shared/remote.ts`, so they can be fixed through `remote-config.json` without a release.
- **Plain words in the interface.** Short sentences, no jargon, and say what happens rather than what something is called.
- **Nothing leaves the browser** except requests to Google with the user's own key. No analytics or other servers.
- **No secrets in commits.** Your key belongs in `.env.local`, which is ignored.
- Add a line to the top section of [`CHANGELOG.md`](CHANGELOG.md) for anything a user would notice.

## Contribution License

By submitting a contribution (a pull request, patch, or any code, documentation, or other material) to this project, you agree that:

1. You are the original author of the contribution, or you have the right to submit it.
2. You grant Arpit Agarwal (the project maintainer and licensor) a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license — with the right to sublicense and relicense — to use, reproduce, modify, adapt, publish, distribute, and **commercially exploit** your contribution, in whole or in part, in any form and through any channel, including in proprietary and commercial versions of Know It (such as paid Chrome Web Store distributions).
3. This grant is in addition to, and broader than, the public license under which the project is distributed. The project is offered to the public under the PolyForm Noncommercial License 1.0.0; your grant to the maintainer above is not limited to noncommercial use.
4. You retain all other rights to your contribution, including the right to use it elsewhere.

If you do not agree to these terms, please do not submit a contribution.
