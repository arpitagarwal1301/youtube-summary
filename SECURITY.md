# Security

## Reporting a problem

Please report security problems privately, through **[Report a vulnerability](https://github.com/arpitagarwal1301/youtube-summary/security/advisories/new)** on GitHub, rather than in a public issue. You'll get a reply within a week.

Useful details: the version (shown in **Settings**), what an attacker could do, and the steps to reproduce it.

## What matters most

- **The Gemini key.** It is kept in `chrome.storage.local` and sent only to `generativelanguage.googleapis.com`. Anything that lets a web page, including YouTube, read it is serious.
- **Injected markup.** Answers come from a model and video details come from uploaders. They must never be put on the page as HTML.
- **Messages between parts of the extension.** The on-page panel and key form are frames owned by the extension, and the messages they send are checked for origin.

Only the latest release is supported.
