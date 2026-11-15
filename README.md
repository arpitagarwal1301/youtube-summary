<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/readme/hero-dark.jpg">
  <img src=".github/assets/readme/hero-light.jpg" alt="Know It for YouTube: know the answer before you click" width="100%">
</picture>

<p align="center">
  <a href="https://getknowit.github.io">Website</a> ·
  <a href="https://github.com/arpitagarwal1301/youtube-summary/releases/latest">Download</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="https://github.com/sponsors/arpitagarwal1301">Sponsor ♥</a>
</p>

**Know It** is a free Chrome extension that answers a YouTube headline without opening the video. Point at a thumbnail, press **Know it**, and get what the title is teasing (the movie, the stock, the price) in one line, with a timestamp to check it.

It runs on your own free Gemini key. No account, no server, no analytics. [See it in action →](https://getknowit.github.io)

## Install

1. Download `know-it.zip` from the [latest release](https://github.com/arpitagarwal1301/youtube-summary/releases/latest) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the folder.
3. Press **Know it** on any video and paste a free key from [Google AI Studio](https://aistudio.google.com/apikey).

In the EU, the UK and Switzerland, Google only allows paid keys: turn on billing for the key first. The Chrome Web Store listing is on its way.

## What it does

- **Know it on every thumbnail**, beside Like on the video you're watching, and in Shorts.
- **One clear answer** with the key facts highlighted, a few points, and **Check it at** to jump to the moment it's said.
- **Today's answers**, from YouTube's top bar, with the minutes it saved you.
- **Auto** *(off by default)* answers videos under 30 minutes as you open them.

## Good to know

- Answers come from an AI model and can be wrong. Use **Check it at** for anything that matters. When a film or song name might be a guess, Know It says so.
- Gemini's free tier covers 8 hours of video a day. Only public videos work.
- Your key and answers stay in your browser. Only the video you ask about (its link, title, channel, description and tags) goes to Google. Read the [privacy policy](store/privacy-policy.md).

## Build from source

```sh
npm install
npm run build    # then Load unpacked the dist folder
npm test
```

[CONTRIBUTING.md](CONTRIBUTING.md) has every command, how the code is laid out, and the checks to run. [RELEASING.md](RELEASING.md) covers releases.

---

<sub>[PolyForm Noncommercial 1.0.0](LICENSE) · [Security](SECURITY.md) · Made by Arpit Agarwal · Not affiliated with YouTube or Google.</sub>
