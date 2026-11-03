# Know It for YouTube

A Chrome extension that answers a YouTube headline without opening the video. Hover over a thumbnail, click **Know it**, and you get what the title is teasing: the movie name, the stock call, the price. The answer comes as one line and a few points with the key facts highlighted. **Show summary** expands the rest.

Gemini watches the video from its URL, so it doesn't need a transcript. The extension also reads the uploader's description and tags, which usually name the film or song that a headline hides.

## How far to trust an answer

Answers come from an AI model and can be wrong, so use the **Check it at** link for anything that matters.

Gemini can't reliably name a film from faces. In testing it named a different wrong film on each try, at high confidence. So if a film or song name isn't in the video's title, tags, description or channel, the extension lowers the confidence and shows a warning. That warning can also appear when the name was only spoken or shown on screen and was actually right.

## Set up

1. Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Run `npm install` and `npm run build`.
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `dist` folder.
4. Paste your key into the settings page that opens, and click **Save and test key**.
5. Refresh any YouTube tabs that were already open.

## Using it

- **Thumbnails:** hover over a video on the home feed, search, the sidebar or a Shorts shelf, and click **Know it**.
- **The video you're on:** click the toolbar icon. On any other page, the icon opens settings.
- **Checking an answer:** the **Check it at** link opens the video at the moment that backs up the answer.
- **While it loads:** you can move on to other thumbnails. A small spinner stays on the video, and it becomes a sparkle you can click when the answer is ready.
- **Answers prepared in advance:** off by default, and you can turn it on in settings. Videos under 9 minutes that stay on screen for a few seconds get prepared one at a time, so they open instantly. This sends those videos to Google and counts towards your daily limit even if you never open them, and it stops at 4 of the 8 hours. It doesn't run on a video's own page.

Answers are saved for 30 days, so reopening one is instant and free. **Ask again** gets a new answer and counts towards the daily limit.

## Limits

- Gemini's free tier allows 8 hours of YouTube video a day, resetting at midnight Pacific time. The extension tracks this itself and stops at the limit. To lift it, change `DAILY_LIMIT_SECONDS` in `src/shared/usage.ts`.
- Only public videos work. Private and unlisted videos, and live streams still in progress, can't be answered.
- Free-tier rate limits can occasionally refuse a request, especially after several long videos in a row. Waiting a minute clears it. Check your limits in [AI Studio](https://aistudio.google.com/rate-limit).
- The default model is Gemini 3.5 Flash-Lite. In testing, Gemini 3.8 Flash was too busy to answer every time. If you choose it and it's busy, the extension switches to Flash-Lite automatically.
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

`npm run test:real -- --prefetch` tries advance preparation for 90 seconds instead, using several short videos from your quota.

`test:real` and `try-videos` read your key from a `.env.local` file containing `GEMINI_API_KEY=your-key`. `try-videos` also takes `--model=`, `--resolution=medium`, `--language=video`, `--title="..."` and `--no-details`.

## How it works

- **`src/content`** shows the button and popover from one shadow root, positioned over YouTube's page rather than added to its elements, so YouTube's re-rendering can't remove them.
- **`src/background`** holds the key, cache and daily limit, reads the video page's details and builds the prompt.
- **`src/offscreen`** makes the Gemini request. Chrome stops a service worker when a response takes over 30 seconds, and a video can take longer than that.
- **`src/options`** is the settings page.

## Publishing

[`store/listing.md`](store/listing.md) has the text for each tab of the Chrome Web Store dashboard, along with what to do before submitting. The privacy policy is [`store/privacy-policy.md`](store/privacy-policy.md).

Know It is not affiliated with or endorsed by YouTube or Google.
