# Chrome Web Store submission

Text to paste into each tab of the [developer dashboard](https://chrome.google.com/webstore/devconsole). Build the upload with `npm run package`, which creates `know-it.zip`.

## Before you submit

1. Replace `REPLACE_WITH_YOUR_EMAIL` in `privacy-policy.html`, and host the page at a public link.
2. Create a spare free Gemini key for the reviewer (see **Test instructions**).

## Store listing tab

**Name** (comes from the manifest): Know It for YouTube

**Summary** (comes from the manifest): Get the answer to a YouTube headline without opening the video.

**Category:** Tools

**Language:** English

**Store icon:** `public/icons/icon128.png`

**Screenshots:** the four files in `store/screenshots`

**Description:**

```text
Get the answer to a YouTube headline without opening the video.

"You won't believe which movie this is." "The one stock to buy now." "What this flat really costs." Hover over a thumbnail, click Know it, and see what the title is teasing: the film, the stock call, the price.

WHAT YOU GET
• A one-line answer, plus a few points with the key facts highlighted
• A link to the moment in the video that backs up the answer
• A warning when a video doesn't deliver on its title, or when a film or song name might be a guess

HOW IT WORKS
• Works on the home feed, search results, the sidebar and Shorts shelves
• Click the toolbar icon to get an answer for the video you're on
• Move on while it loads: a spinner stays on the thumbnail and becomes a sparkle when the answer is ready
• Answers are saved for 30 days, so reopening one is instant
• Optional: prepare answers in advance for short videos, so they open instantly

WHAT YOU NEED
• A Gemini API key from Google AI Studio. The free tier allows 8 hours of YouTube video a day, and the extension keeps count so you stay inside it.
• You must be 18 or older, as Gemini's terms require.

GOOD TO KNOW
• Answers come from an AI model and can be wrong, so check anything that matters using the link in the answer.
• Only public videos work. Live streams can't be answered until they have finished.
• The video's link, title, channel, description and tags go to Google's Gemini API using your key. Nothing goes to the extension's developer. On Gemini's free tier, Google may use what it receives to improve its products, and people may review it.

Know It is not affiliated with or endorsed by YouTube or Google. YouTube is a trademark of Google LLC.
```

## Privacy tab

**Single purpose:**

```text
Answers the headline of a YouTube video without opening it: the user clicks a button on a thumbnail, and the extension shows what the title is teasing, using the user's own Gemini API key.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Stores the user's Gemini API key, settings, saved answers and daily usage count in the browser. |
| `offscreen` | Keeps a Gemini request running. A video can take longer than 30 seconds to process, and Chrome stops a service worker's fetch after that. |
| `scripting` | When the user clicks the toolbar icon on a YouTube tab that was open before the extension was installed, this adds the extension's script to that tab so it can show the answer. |
| Host `https://www.youtube.com/*` | Shows the Know it button on video thumbnails, and reads the public description and tags from a video's page to improve the answer. |
| Host `https://generativelanguage.googleapis.com/*` | Sends the user's request to the Gemini API, using the user's own key. |

**Remote code:** No, I am not using remote code.

**Data usage**, what to tick. These labels are from memory, so check them against the dashboard:

- **Authentication information:** the user's Gemini API key.
- **Web history:** the link of the video the user asks about, which can be the video they're on.
- **Website content:** the video's title, channel, description and tags.

**Certifications:** tick all three. The privacy policy states each of them.

- Not sold to third parties, outside the approved use cases.
- Not used for purposes unrelated to the single purpose.
- Not used to determine creditworthiness or for lending.

**Privacy policy URL:** the public link to `privacy-policy.html`.

## Distribution tab

**Payment:** Free

**Visibility:** Unlisted to start. It goes through the same review, but only people with the link can install it. Change it to Public when you're ready.

**Regions:** select individually and leave these out, because Gemini's terms allow only paid services for users there:

Austria, Belgium, Bulgaria, Croatia, Cyprus, Czechia, Denmark, Estonia, Finland, France, Germany, Greece, Hungary, Iceland, Ireland, Italy, Latvia, Liechtenstein, Lithuania, Luxembourg, Malta, Netherlands, Norway, Poland, Portugal, Romania, Slovakia, Slovenia, Spain, Sweden, Switzerland, United Kingdom.

## Test instructions tab

The extension does nothing without a key, so a reviewer needs one. Use a spare key made for this, and delete it in Google AI Studio once the review is done. Only reviewers see this tab, so don't put the key anywhere else.

```text
The extension needs a Gemini API key. Use this test key:

REPLACE_WITH_A_SPARE_TEST_KEY

1. On the settings page that opens after installing, paste the key and click "Save and test key".
2. Open https://www.youtube.com/results?search_query=stocks+explained+with+bananas
3. Hover over a video's thumbnail and click "Know it" at its top left.
4. The answer appears in a popover next to the thumbnail, usually within about 30 seconds.
```
