# Know It for YouTube

A Chrome extension that answers a YouTube headline without opening the video. Hover over a thumbnail, click **Know it**, and you get what the title is teasing: the movie name, the stock call, the price. The answer comes as one line and a few points with the key facts highlighted. **Show summary** expands the rest.

Gemini watches the video from its URL, so it doesn't need a transcript. The extension also reads the uploader's description and tags, which usually name the film or song that a headline hides.

## How far to trust an answer

Answers come from an AI model and can be wrong, so use the **Check it at** link for anything that matters.

Gemini can't reliably name a film from faces. In testing it named a different wrong film on each try, at high confidence. So if a film or song name isn't in the video's title, tags, description or channel, the extension lowers the confidence and shows a warning. That warning can also appear when the name was only spoken or shown on screen and was actually right.

## Set up

1. Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey). In the EU, the UK and Switzerland, Google allows only paid keys, so turn on billing for the key's project first.
2. Run `npm install` and `npm run build`.
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `dist` folder.
4. Paste your key into the welcome page that opens, and click **Save and test**. You can also skip this: the first **Know it** click on YouTube shows the same two steps.

## Using it

- **Thumbnails:** hover over a video on the home feed, search, the sidebar or a Shorts shelf, and click **Know it**.
- **The video you're on:** press **Know it** beside its title, or beside the player on a Short. **Jump to** moves the player to the moment that backs up the answer.
- **While it loads:** move on to other thumbnails. A small spinner stays on the video. If the answer arrives while the popover is closed, it pops up as a note on the page, or as a desktop notification if YouTube isn't in view.
- **Auto:** off by default. Turn on the switch beside the button and each video under 30 minutes you open is answered after 5 seconds. It skips live streams and Shorts, and stops at 4 of the 8 hours.
- **The toolbar panel:** time left today, today's answers with their summaries and a **Copy** button, and settings under **More**.

Answers are kept for 24 hours, so reopening one is instant and free. **Ask again** gets a new answer and counts towards the daily limit.

## Limits

- Gemini's free tier allows 8 hours of YouTube video a day, resetting at midnight Pacific time. The extension tracks this itself and stops at the limit. To lift it, change `DAILY_LIMIT_SECONDS` in `src/shared/usage.ts`.
- Only public videos work. Private and unlisted videos, and live streams still in progress, can't be answered.
- Free-tier rate limits can occasionally refuse a request, especially after several long videos in a row. Waiting a minute clears it. Check your limits in [AI Studio](https://aistudio.google.com/rate-limit).
- The model is **Automatic** by default: Google's `gemini-flash-lite-latest`, which follows its newest Flash-Lite. If it's busy, the extension tries `gemini-3.1-flash-lite`. You can pin another model under **More → Advanced**.
- The daily count only includes answers requested through the extension in this browser, so other use of your key isn't counted.

## Commands

| Command | What it does |
| --- | --- |
| `npm run build` | Builds the extension into `dist` |
| `npm run watch` | Rebuilds on every change |
| `npm run typecheck` | Checks types |
| `npm test` | Runs the unit tests |
| `npm run test:e2e` | Runs the extension on real YouTube with a mock Gemini, saving screenshots to `e2e/output` |
| `npm run test:real` | Runs the production build on real YouTube with the real Gemini, using one short video from your quota |
| `npm run try-videos -- <urls>` | Sends real videos to Gemini and prints speed, tokens and answers |
| `npm run package` | Builds the extension and zips it into `know-it.zip` for the Chrome Web Store |
| `npm run store-screenshots` | Captures the store screenshots from `dist` into `store/screenshots`, using no API key |
| `npm run release -- <version>` | Bumps the version, runs the tests, builds `know-it.zip` and publishes a GitHub release with that version's changelog |

`test:real` and `try-videos` read your key from a `.env.local` file containing `GEMINI_API_KEY=your-key`. `try-videos` also takes `--model=`, `--resolution=medium`, `--language=video`, `--title="..."` and `--no-details`.

## How it works

- **`src/content`** shows the button and popover from one shadow root, positioned over YouTube's page rather than added to its elements, so YouTube's re-rendering can't remove them.
- **`src/background`** holds the key, saved answers and daily limit, reads the video page's details, builds the prompt and raises notifications.
- **`src/offscreen`** makes the Gemini request. Chrome stops a service worker when a response takes over 30 seconds, and a video can take longer than that.
- **`src/panel`** is the toolbar panel, and **`src/setup`** is the key form shown inside the popover on YouTube.

## Updates without a release

[`remote-config.json`](remote-config.json) is read once a day. It can change the automatic and fallback models, the CSS selectors used to read YouTube's pages, the panel's links, and a one-line notice in the panel. It holds data only, every value is checked, and anything missing or invalid falls back to what's built in (`src/shared/remote.ts`). Anything else needs a release through the Chrome Web Store.

## Releasing

1. Add the new version's notes at the top of [`CHANGELOG.md`](CHANGELOG.md), under `## <version>`.
2. Run `npm run release -- 1.2.0`.
3. Upload `know-it.zip` in the [developer dashboard](https://chrome.google.com/webstore/devconsole).

## Publishing

[`store/listing.md`](store/listing.md) has the text for each tab of the Chrome Web Store dashboard, along with what to do before submitting. The privacy policy is [`store/privacy-policy.md`](store/privacy-policy.md).

## Support

Know It is free and made by one person. If it saves you time, you can [sponsor it on GitHub](https://github.com/sponsors/arpitagarwal1301).

Know It is not affiliated with or endorsed by YouTube or Google.
