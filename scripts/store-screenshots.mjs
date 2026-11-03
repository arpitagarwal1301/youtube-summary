// Captures the Chrome Web Store screenshots from the production build, on real YouTube.
// It uses no API key: the answer shown is one Gemini really gave, saved as if the extension had fetched it.
// Run `npm run build` first.
import { chromium } from 'playwright';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extension = join(root, 'dist');
const output = join(root, 'store/screenshots');
await mkdir(output, { recursive: true });

// Must match PROMPT_VERSION in src/shared/cache.ts. The checks below fail if it doesn't.
const answerKey = (videoId) => `answer:5:english:${videoId}`;
const SEARCH_URL = 'https://www.youtube.com/results?search_query=stocks+explained+with+bananas';
const TITLE = 'Stocks Explained with Bananas';
const ANSWER = {
  category: 'finance',
  question: 'What is a stock and how does the stock market work?',
  answer: 'A stock is a small piece of a banana business, and **stocks** represent partial ownership that lets investors share in **profits** and **dividends**.',
  keyPoints: [
    'Buying a stock makes rich monkeys **partial owners** of banana business.',
    'Stocks and shares are different; shares are the **individual pieces** of stock.',
    'The **stock market** is where monkey companies set up to buy and sell stocks.',
  ],
  summary: [],
  confidence: 'high',
  titleDelivers: true,
  evidence: { seconds: 24, note: 'A piece of a banana labeled STOCK between a rich monkey and a monkey.' },
};
// Ads, Shorts shelves and channel cards would put other people's faces and contact details in the store listing.
const HIDE_STYLE = 'ytd-ad-slot-renderer, ytd-search-pyv-renderer, ytd-reel-shelf-renderer, grid-shelf-view-model, ytd-shelf-renderer, ytd-channel-renderer { display: none !important; }';

const profile = await mkdtemp(join(tmpdir(), 'know-it-store-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  locale: 'en-US',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const shot = (name) => page.screenshot({ path: join(output, name) });

  const openResults = async () => {
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: HIDE_STYLE });
    const card = page.locator('ytd-video-renderer', { hasText: TITLE }).first();
    await card.waitFor({ timeout: 30_000 });
    await page.mouse.move(2, 400);
    await card.evaluate((element) => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 70));
    await page.waitForFunction(() => [...document.querySelectorAll('ytd-video-renderer img')].slice(0, 2).every((img) => img.complete && img.naturalWidth > 0));
    return card;
  };
  const thumbnailOf = (card) => card.locator('a[href*="watch?v="]:has(img), a[href*="watch?v="]:has(yt-thumbnail-view-model)').first();
  const videoIdOf = async (card) => new URL(await thumbnailOf(card).getAttribute('href'), 'https://www.youtube.com').searchParams.get('v');

  // 1. The button on a thumbnail.
  const card = await openResults();
  await thumbnailOf(card).hover();
  await page.locator('know-it-root .know-it').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(300);
  await shot('1-know-it-button.png');

  // 2. A ready sparkle on one video, and a spinner on another.
  const videoId = await videoIdOf(card);
  const nextCard = page.locator('ytd-video-renderer').nth(1);
  const nextId = await videoIdOf(nextCard);
  if (!videoId || !nextId || videoId === nextId) throw new Error(`Could not read two videos: ${videoId}, ${nextId}`);
  await worker.evaluate(
    async ([readyKey, loadingKey, answer, loadingId]) => {
      await chrome.storage.local.set({ [readyKey]: { answer, savedAt: Date.now() } });
      await chrome.storage.session.set({ jobs: { [loadingKey]: { video: { videoId: loadingId, title: '' }, tabIds: [], startedAt: Date.now() } } });
    },
    [answerKey(videoId), answerKey(nextId), ANSWER, nextId],
  );
  await openResults();
  const ready = page.locator('know-it-root .marker[data-status="ready"]');
  await ready.waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('know-it-root .marker[data-status="loading"]').waitFor({ state: 'visible', timeout: 10_000 });
  await shot('2-loading-and-ready.png');

  // 3. The answer.
  await ready.click();
  const popover = page.locator('know-it-root .popover');
  await popover.locator('mark').first().waitFor({ state: 'visible', timeout: 5000 });
  await shot('3-answer.png');

  // 4. Settings, with no key in the field.
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.locator('#prefetch').waitFor();
  await shot('4-settings.png');
  console.log(`Saved 4 screenshots to ${output}`);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
