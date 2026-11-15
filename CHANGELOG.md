# Changelog

## Unreleased

Changed

- Copied answers link to the new [Know It website](https://getknowit.github.io), and **Privacy** in Settings opens the policy there.

Fixed

- After an update, YouTube tabs that were already open switch to the new version straight away. Before, their button stopped working until the page was reloaded.

## 1.1.0 — Answers right on YouTube

New

- **Today's answers.** A button in YouTube's top bar, beside the mic, opens today's answers right on the page, with how many minutes Know It saved you today. The same panel opens from Chrome's toolbar. Settings, with Auto first, are behind the ⚙ there.
- **Setup on YouTube.** The first time you press Know it, the popover shows the two steps to get a free key and answers the video once it is saved. The key field is the extension's own frame, so YouTube can't read it.
- **A button on the video you're watching**, just left of Like, and one inside the Shorts player. Its timestamp link moves the player instead of opening a tab.
- **Auto-answer**, off by default. Turn on the **Auto** switch beside the button and each video under 30 minutes you open is answered after 5 seconds, using at most 4 of your 8 free hours.
- **Answers that arrive while you're elsewhere** pop up as a note on the page, and as a desktop notification if YouTube isn't in view. You can turn notifications off in **Settings**.
- **Copy** an answer to share it, with the video's link.
- **Paid keys work too.** In the EU, the UK and Switzerland, where Google refuses free keys, Know It says to turn on billing for the key.
- **Automatic model.** Know It follows Google's newest fast model without needing an update. You can still pin a model under **Settings → Advanced**.

Changed

- Answers are kept for 24 hours instead of 30 days.
- Thumbnails are no longer prepared in advance while you browse. Nothing is sent until you press Know it, or open a video with Auto on.
- Reopening a video that is still loading carries on its timer, and a saved answer opens without a loading flash.
- A failed answer stays marked on its thumbnail, and isn't asked again until you press Try again.
- The popover closes when its video scrolls off screen.

## 1.0.0

First release.
