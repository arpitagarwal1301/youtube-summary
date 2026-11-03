// Runs the built extension in Chromium on the real YouTube site, with a local mock in place of Gemini.
// No API key or sign-in is used. Screenshots go to e2e/output.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'e2e/output');
const PORT = 8765;
const MOCK_BASE = `http://127.0.0.1:${PORT}`;
const FAKE_KEY = 'fake-e2e-key';
const SLOW_MS = 40_000;

// ---- Mock Gemini ----

const mock = { requests: [], nextDelayMs: 0, nextError: null, defaultDelayMs: 0, inFlight: 0, maxInFlight: 0 };

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', async () => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.headers['x-goog-api-key'] !== FAKE_KEY) {
      return send(400, { error: { message: 'API key not valid. Please pass a valid API key.' } });
    }
    if (req.method === 'GET') return send(200, { models: [] });

    const body = JSON.parse(raw);
    mock.requests.push({ url: req.url, body });

    const delay = mock.nextDelayMs || mock.defaultDelayMs;
    const error = mock.nextError;
    mock.nextDelayMs = 0;
    mock.nextError = null;
    mock.inFlight++;
    mock.maxInFlight = Math.max(mock.maxInFlight, mock.inFlight);
    await new Promise((resolve) => setTimeout(resolve, delay));
    mock.inFlight--;

    if (error) return send(error.status, { error: { message: error.message } });

    const answer = {
      category: 'movie_tv',
      question: 'What does the headline actually mean?',
      answer: 'MOCK ANSWER: this is the **direct answer** to the headline.',
      keyPoints: ['First key point costs **₹4.25 Cr**', 'Second key point names **someone**'],
      summary: ['First mock point', 'Second mock point', 'Third mock point'],
      confidence: 'medium',
      titleDelivers: false,
      name: 'A Film No Page Mentions',
      evidenceTimestamp: '0:30',
      evidenceNote: 'where it is said',
    };
    send(200, {
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(answer) }] } }],
      usageMetadata: { promptTokensDetails: [{ modality: 'VIDEO', tokenCount: 30000 }] },
    });
  });
});

// ---- Test helpers ----

const results = [];
let activePage = null;
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  FAIL  ${name}\n        ${String(err.message).split('\n')[0]}`);
    if (activePage) {
      const slug = name.replace(/\W+/g, '-').slice(0, 40);
      await activePage.screenshot({ path: join(output, `fail-${slug}.png`) }).catch(() => undefined);
      const text = await activePage.locator('know-it-root .popover').textContent().catch(() => '');
      console.log(`        popover text: ${text}`);
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** First video card thumbnail on screen, with its video ID. */
async function firstThumbnail(page) {
  const links = page.locator('a[href*="/watch?v="]:has(img), a[href*="/watch?v="]:has(yt-thumbnail-view-model)');
  await links.first().waitFor({ timeout: 30_000 });
  const count = await links.count();
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const box = await link.boundingBox();
    if (box && box.width > 150 && box.y >= 0 && box.y + box.height < page.viewportSize().height) return link;
  }
  await links.first().scrollIntoViewIfNeeded();
  return links.first();
}

/** Accepts nothing: picks the option that declines non-essential cookies if YouTube asks. */
async function declineConsent(page) {
  const reject = page.getByRole('button', { name: /reject all/i }).first();
  if (await reject.isVisible({ timeout: 3000 }).catch(() => false)) {
    await reject.click();
    await page.waitForLoadState('domcontentloaded');
  }
}

async function run() {
  await mkdir(output, { recursive: true });
  execFileSync('node', ['scripts/build.mjs'], {
    cwd: root,
    env: { ...process.env, GEMINI_MOCK_BASE: MOCK_BASE },
    stdio: 'inherit',
  });
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

  const extension = join(root, 'dist-e2e');
  const profile = await mkdtemp(join(tmpdir(), 'know-it-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1400, height: 900 },
    locale: 'en-US',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const extensionId = new URL(worker.url()).host;
    const page = context.pages()[0];
    activePage = page;

    const button = page.locator('know-it-root .know-it');
    const popover = page.locator('know-it-root .popover');
    const setStorage = (items) => worker.evaluate((value) => chrome.storage.local.set(value), items);
    const getStorage = (key) => worker.evaluate((name) => chrome.storage.local.get(name), key);

    console.log('Settings page');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await check('no key: a wrong key is reported', async () => {
      await options.fill('#api-key', 'wrong-key');
      await options.click('#save-key');
      await options.locator('#key-status.bad').waitFor({ timeout: 5000 });
    });
    await options.fill('#api-key', '');
    await options.click('#save-key');
    await options.locator('#key-status', { hasText: 'Key removed' }).waitFor({ timeout: 5000 });
    await options.screenshot({ path: join(output, 'options.png') });

    console.log('Search results on real YouTube');
    await page.bringToFront();
    await page.goto('https://www.youtube.com/results?search_query=weekend+investing', { waitUntil: 'domcontentloaded' });
    await declineConsent(page);
    let thumb = await firstThumbnail(page);
    const href = await thumb.getAttribute('href');
    const videoId = new URL(href, 'https://www.youtube.com').searchParams.get('v');
    const startUrl = page.url();

    await check('hover shows the button on the thumbnail', async () => {
      await thumb.hover();
      await button.waitFor({ state: 'visible', timeout: 5000 });
      const buttonBox = await button.boundingBox();
      const thumbBox = await thumb.boundingBox();
      assert(
        buttonBox.x >= thumbBox.x && buttonBox.x < thumbBox.x + thumbBox.width && buttonBox.y >= thumbBox.y,
        `button at ${JSON.stringify(buttonBox)}, thumbnail at ${JSON.stringify(thumbBox)}`,
      );
    });

    await check('button stays while the preview player starts', async () => {
      await page.waitForTimeout(4000);
      assert(await button.isVisible(), 'button disappeared after 4 seconds of hovering');
    });
    await page.screenshot({ path: join(output, 'hover.png') });

    await check('without a key, it asks for one and sends nothing', async () => {
      await button.click();
      await popover.getByText('Add your free Gemini API key').waitFor({ timeout: 5000 });
      await popover.getByRole('button', { name: 'Open settings' }).waitFor({ timeout: 2000 });
      assert(mock.requests.length === 0, 'a request was sent');
    });
    await page.keyboard.press('Escape');

    await setStorage({ settings: { apiKey: FAKE_KEY, model: 'gemini-3.5-flash-lite', language: 'english', prefetch: false } });

    await check('click shows an answer and does not open the video', async () => {
      await thumb.hover();
      await button.click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 15_000 });
      assert(page.url() === startUrl, `page moved to ${page.url()}`);
    });
    await page.screenshot({ path: join(output, 'answer.png') });

    await check('request has the right video, headline and key handling', async () => {
      assert(mock.requests.length === 1, `${mock.requests.length} requests`);
      const { url, body } = mock.requests[0];
      const [videoPart, textPart] = body.contents[0].parts;
      assert(videoPart.fileData.fileUri === `https://www.youtube.com/watch?v=${videoId}`, videoPart.fileData.fileUri);
      assert(!url.includes(FAKE_KEY), 'key is in the URL');
      const headline = textPart.text.match(/Headline: (.*)/)[1];
      assert(headline.length > 5 && headline !== '(unknown)', `headline read as "${headline}"`);
      console.log(`        headline: ${headline}`);
      assert(textPart.text.includes("Uploader's"), 'no description or tags were read from the real video page');
      console.log(`        channel:  ${textPart.text.match(/Channel: (.*)/)[1]}`);
      console.log(`        length:   ${textPart.text.match(/Length: (.*)/)?.[1] ?? '(none)'}`);
    });

    await check('answer shows as points, with highlights and no stray asterisks', async () => {
      assert((await popover.locator('.answer mark').textContent()) === 'direct answer', 'answer highlight missing');
      assert((await popover.locator('.points li').count()) === 2, 'key points missing');
      assert((await popover.locator('.points mark').first().textContent()) === '₹4.25 Cr', 'point highlight missing');
      assert(!(await popover.textContent()).includes('**'), 'asterisks are showing');
    });

    await check('summary expands without another request', async () => {
      await popover.getByRole('button', { name: 'Show summary' }).click();
      await popover.getByText('Second mock point').waitFor({ timeout: 2000 });
      assert(mock.requests.length === 1, 'summary made a request');
    });
    await page.screenshot({ path: join(output, 'summary.png') });

    await check('timestamp link and misleading-title warning show', async () => {
      const link = popover.getByRole('link', { name: /Check it at 0:30/ });
      assert((await link.getAttribute('href')).endsWith(`v=${videoId}&t=30s`), await link.getAttribute('href'));
      await popover.getByText('does not really deliver').waitFor({ timeout: 2000 });
      await popover.getByText('may be a wrong guess').waitFor({ timeout: 2000 });
      await popover.getByText('Low confidence').waitFor({ timeout: 2000 });
    });

    await check('Escape closes the popover', async () => {
      await page.keyboard.press('Escape');
      await popover.waitFor({ state: 'hidden', timeout: 2000 });
    });

    await check('reopening uses the saved answer', async () => {
      await thumb.hover();
      await button.click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 5000 });
      await popover.getByRole('button', { name: 'Ask again' }).waitFor({ timeout: 2000 });
      assert(mock.requests.length === 1, 'cached answer made a request');
    });

    await check('clicking elsewhere closes the popover', async () => {
      await page.mouse.click(5, 450);
      await popover.waitFor({ state: 'hidden', timeout: 2000 });
    });

    await check('usage counts towards the daily limit', async () => {
      const { usage } = await getStorage('usage');
      assert(usage?.seconds > 0, `usage is ${JSON.stringify(usage)}`);
      console.log(`        counted ${usage.seconds}s`);
    });

    console.log('Errors');
    const answerFresh = async () => {
      await popover.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => page.keyboard.press('Escape'));
      await thumb.hover();
      await button.click();
      await popover.getByRole('button', { name: 'Ask again' }).click();
    };

    await check('free-tier rate limit is explained', async () => {
      mock.nextError = { status: 429, message: 'Quota exceeded' };
      await answerFresh();
      await popover.getByText('free-tier limit').waitFor({ timeout: 10_000 });
      await popover.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 2000 });
    });
    await page.keyboard.press('Escape');

    await check('private video is explained, with no retry offered', async () => {
      mock.nextError = { status: 400, message: 'Cannot fetch the video. Video is private.' };
      await answerFresh();
      await popover.getByText('cannot open this video').waitFor({ timeout: 10_000 });
      assert((await popover.getByRole('button', { name: 'Try again' }).count()) === 0, 'retry was offered');
    });
    await page.screenshot({ path: join(output, 'error.png') });
    await page.keyboard.press('Escape');

    await check('a busy model switches to Flash-Lite and still answers', async () => {
      await setStorage({ settings: { apiKey: FAKE_KEY, model: 'gemini-3.8-flash', language: 'english', prefetch: false } });
      const before = mock.requests.length;
      mock.nextError = { status: 503, message: 'This model is currently experiencing high demand.' };
      await answerFresh();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 10_000 });
      const urls = mock.requests.slice(before).map((request) => request.url);
      assert(urls.length === 2 && urls[0].includes('gemini-3.8-flash') && urls[1].includes('gemini-3.5-flash-lite'), urls.join(', '));
      await setStorage({ settings: { apiKey: FAKE_KEY, model: 'gemini-3.5-flash-lite', language: 'english', prefetch: false } });
    });
    await page.keyboard.press('Escape');

    await check('daily limit stops new requests', async () => {
      const before = mock.requests.length;
      const { usage } = await getStorage('usage');
      await setStorage({ usage: { day: usage.day, seconds: 8 * 3600 } });
      await answerFresh();
      await popover.getByText('free limit of 8 hours').waitFor({ timeout: 5000 });
      assert(mock.requests.length === before, 'request was sent past the limit');
      await setStorage({ usage });
    });
    await page.keyboard.press('Escape');

    await check('ten requests straight after each other all finish', async () => {
      const before = mock.requests.length;
      for (let i = 0; i < 10; i++) {
        await popover.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => page.keyboard.press('Escape'));
        await answerFresh();
        await popover.getByText('MOCK ANSWER').waitFor({ timeout: 10_000 });
        await page.keyboard.press('Escape');
      }
      assert(mock.requests.length === before + 10, `${mock.requests.length - before} requests reached Gemini`);
    });

    console.log('Slow answers');
    await check(`answer still arrives after ${SLOW_MS / 1000}s (past the 30s worker limit)`, async () => {
      mock.nextDelayMs = SLOW_MS;
      await answerFresh();
      await popover.getByText('Watching the video').waitFor({ timeout: 5000 });
      await page.screenshot({ path: join(output, 'loading.png') });
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: SLOW_MS + 20_000 });
    });
    await page.keyboard.press('Escape');

    console.log('Other pages');
    await check('closing while loading still saves the answer', async () => {
      await page.mouse.move(5, 450);
      const links = page.locator('a[href*="/watch?v="]:has(img), a[href*="/watch?v="]:has(yt-thumbnail-view-model)');
      let other = null;
      const seen = await links.count();
      for (let i = 0; i < seen; i++) {
        const candidate = links.nth(i);
        const candidateId = new URL((await candidate.getAttribute('href')), 'https://www.youtube.com').searchParams.get('v');
        if (candidateId && candidateId !== videoId) {
          other = candidate;
          break;
        }
      }
      assert(other, 'no second video found');
      await other.scrollIntoViewIfNeeded();
      const before = mock.requests.length;
      mock.nextDelayMs = 3000;
      await other.hover();
      await button.click();
      await popover.getByText('Watching the video').waitFor({ timeout: 5000 });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(5000);
      await other.hover();
      await button.click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 5000 });
      assert(mock.requests.length === before + 1, 'it asked Gemini twice');
      await page.keyboard.press('Escape');
    });

    await check('moving away hides the button', async () => {
      await thumb.scrollIntoViewIfNeeded();
      await thumb.hover();
      await button.waitFor({ state: 'visible', timeout: 5000 });
      await page.mouse.move(2, 2);
      await button.waitFor({ state: 'hidden', timeout: 3000 });
    });

    await check('works in the sidebar of a video, after in-app navigation', async () => {
      await thumb.click();
      await page.waitForURL(/watch\?v=/, { timeout: 15_000 });
      const sidebar = page.locator(
        'ytd-watch-next-secondary-results-renderer a[href*="/watch?v="]:has(img), ytd-watch-next-secondary-results-renderer a[href*="/watch?v="]:has(yt-thumbnail-view-model)',
      );
      await sidebar.first().waitFor({ timeout: 30_000 });
      await sidebar.first().scrollIntoViewIfNeeded();
      await sidebar.first().hover();
      await button.waitFor({ state: 'visible', timeout: 5000 });
      await button.click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 15_000 });
    });
    await page.screenshot({ path: join(output, 'sidebar.png') });
    await page.keyboard.press('Escape');

    await check('toolbar icon answers the open video', async () => {
      await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' });
        await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_FOR_PAGE' });
      });
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 15_000 });
      const last = mock.requests.at(-1).body.contents[0].parts;
      const pageId = new URL(page.url()).searchParams.get('v');
      assert(last[0].fileData.fileUri.endsWith(pageId) || (await popover.getByRole('button', { name: 'Ask again' }).count()) === 1, 'wrong video');
    });
    await page.screenshot({ path: join(output, 'toolbar.png') });
    await page.keyboard.press('Escape');

    console.log('Home page and Shorts');
    await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
    await declineConsent(page);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(output, 'home.png') });
    const homeCards = await page.locator('ytd-rich-item-renderer a[href*="/watch?v="]:has(img)').count();
    console.log(`        ${homeCards} home feed cards (signed-out feeds can be empty)`);
    if (homeCards > 0) {
      await check('works on the home feed', async () => {
        // A card showing a length, because the first one on a feed can be a live stream or a Mix.
        const card = page
          .locator('ytd-rich-item-renderer:not(:has(ytd-ad-slot-renderer)) a[href*="/watch?v="]:has(img)')
          .filter({ hasText: /\b\d{1,2}:\d{2}\b/ })
          .first();
        await card.scrollIntoViewIfNeeded();
        await card.hover();
        await button.waitFor({ state: 'visible', timeout: 5000 });
        await button.click();
        await popover.getByText('MOCK ANSWER').waitFor({ timeout: 15_000 });
      });
      await page.screenshot({ path: join(output, 'home-answer.png') });
      await page.keyboard.press('Escape');

      const ad = page.locator('ytd-ad-slot-renderer a[href*="/watch?v="]:has(img)').first();
      if (await ad.count()) {
        await check('a sponsored video gets no button', async () => {
          await page.mouse.move(2, 2);
          await button.waitFor({ state: 'hidden', timeout: 3000 });
          await ad.scrollIntoViewIfNeeded();
          await ad.hover();
          await page.waitForTimeout(1000);
          assert(!(await button.isVisible()), 'button appeared on an ad');
        });
      } else {
        console.log('        no sponsored video on this feed');
      }
      await page.keyboard.press('Escape');

      // Cards like the NDTV Profit one: a finished video from a channel whose avatar has a LIVE ring.
      const ringHref = await page.evaluate(() => {
        for (const card of document.querySelectorAll('ytd-rich-item-renderer')) {
          const link = [...card.querySelectorAll('a[href*="/watch?v="]')].find((a) => a.querySelector('img'));
          if (!link) continue;
          const leaves = (root) => [...root.querySelectorAll('*')].filter((n) => !n.childElementCount).map((n) => n.textContent.trim());
          const hasDuration = leaves(link).some((text) => /^\d+:\d{2}/.test(text));
          const liveRing = leaves(card).includes('LIVE') && !leaves(link).includes('LIVE');
          if (hasDuration && liveRing) return link.getAttribute('href');
        }
        return null;
      });
      if (ringHref) {
        await check('a finished video with a LIVE ring on its avatar is still answered', async () => {
          const card = page.locator(`ytd-rich-item-renderer a[href="${ringHref}"]:has(img)`).first();
          await card.scrollIntoViewIfNeeded();
          await card.hover();
          await button.waitFor({ state: 'visible', timeout: 5000 });
          await button.click();
          await popover.getByText('MOCK ANSWER').waitFor({ timeout: 15_000 });
          await page.keyboard.press('Escape');
        });
      } else {
        console.log('        no card with a LIVE avatar ring on this feed');
      }
    }

    await check('works on a Shorts shelf or Shorts results', async () => {
      await page.goto('https://www.youtube.com/results?search_query=stock+market+shorts', { waitUntil: 'domcontentloaded' });
      const shorts = page.locator('a[href^="/shorts/"]:has(img), a[href^="/shorts/"]:has(yt-thumbnail-view-model)');
      await shorts.first().waitFor({ timeout: 30_000 });
      await shorts.first().scrollIntoViewIfNeeded();
      await shorts.first().hover();
      // The results page can still be shifting, leaving the pointer off the card until it moves again.
      await button.waitFor({ state: 'visible', timeout: 1500 }).catch(() => shorts.first().hover({ position: { x: 20, y: 60 } }));
      await button.waitFor({ state: 'visible', timeout: 5000 });
      await button.click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 15_000 });
      const shortId = (await shorts.first().getAttribute('href')).split('/')[2];
      const uri = mock.requests.at(-1).body.contents[0].parts[0].fileData.fileUri;
      assert(uri === `https://www.youtube.com/watch?v=${shortId}`, uri);
    });
    await page.screenshot({ path: join(output, 'shorts.png') });

    await check('a real live stream card is refused without asking Gemini', async () => {
      await page.keyboard.press('Escape');
      await page.goto('https://www.youtube.com/results?search_query=news&sp=EgJAAQ%253D%253D', { waitUntil: 'domcontentloaded' });
      const live = await firstThumbnail(page);
      const before = mock.requests.length;
      await live.hover();
      await button.waitFor({ state: 'visible', timeout: 5000 });
      await button.click();
      await popover.getByText('Live streams cannot be answered').waitFor({ timeout: 5000 });
      assert(mock.requests.length === before, 'a request was sent');
    });
    await page.screenshot({ path: join(output, 'live.png') });
    await page.goto('https://www.youtube.com/results?search_query=stock+market+shorts', { waitUntil: 'domcontentloaded' });
    await page.locator('a[href^="/shorts/"]:has(img), a[href^="/shorts/"]:has(yt-thumbnail-view-model)').first().waitFor({ timeout: 30_000 });

    await check('dark YouTube gets the dark popover', async () => {
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.documentElement.setAttribute('dark', ''));
      await page.locator('a[href^="/shorts/"]:has(img), a[href^="/shorts/"]:has(yt-thumbnail-view-model)').first().hover();
      await button.click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 15_000 });
      const dark = await page.locator('know-it-root .root').evaluate((node) => node.classList.contains('dark'));
      assert(dark, 'popover is not in dark mode');
    });
    await page.screenshot({ path: join(output, 'dark.png') });

    console.log('Sparkle button and loaders');
    const settingsWith = (prefetch) => ({ settings: { apiKey: FAKE_KEY, model: 'gemini-3.5-flash-lite', language: 'english', prefetch } });
    const clearAnswers = () =>
      worker.evaluate(async () => {
        const all = await chrome.storage.local.get(null);
        await chrome.storage.local.remove(Object.keys(all).filter((key) => key.startsWith('answer:')));
      });
    const videoIdOf = (href) => {
      const url = new URL(href, 'https://www.youtube.com');
      return url.searchParams.get('v') ?? url.pathname.split('/')[2];
    };
    const requestedIds = (from = 0) => mock.requests.slice(from).map((request) => videoIdOf(request.body.contents[0].parts[0].fileData.fileUri));
    const THUMBNAILS = 'a[href*="/watch?v="]:has(img), a[href*="/watch?v="]:has(yt-thumbnail-view-model), a[href^="/shorts/"]:has(img), a[href^="/shorts/"]:has(yt-thumbnail-view-model)';
    /** Thumbnails fully on screen, one per video. */
    const onScreenThumbnails = async () => {
      const links = page.locator(THUMBNAILS);
      const found = new Map();
      for (let i = 0; i < (await links.count()); i++) {
        const link = links.nth(i);
        const box = await link.boundingBox();
        if (!box || box.width < 150 || box.y < 60 || box.y + box.height > page.viewportSize().height) continue;
        if (await link.evaluate((node) => !!node.closest('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-video-renderer'))) continue;
        const id = videoIdOf(await link.getAttribute('href'));
        if (!found.has(id)) found.set(id, link);
      }
      return [...found.values()];
    };
    const marker = (status) => page.locator(`know-it-root .marker[data-status="${status}"]`);
    const buttonLabel = () => button.locator('span').last().textContent();

    const SHORT_RESULTS = 'https://www.youtube.com/results?search_query=stock+market+explained&sp=EgIYAQ%253D%253D';
    await page.keyboard.press('Escape');
    await clearAnswers();
    await setStorage(settingsWith(false));
    await page.goto(SHORT_RESULTS, { waitUntil: 'domcontentloaded' });
    await page.locator(THUMBNAILS).first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2000);
    const [firstCard, secondCard] = await onScreenThumbnails();

    await check('button shows the sparkle icon and "Know it"', async () => {
      await firstCard.hover();
      await button.waitFor({ state: 'visible', timeout: 5000 });
      assert(await button.locator('svg.sparkle').isVisible(), 'sparkle is not visible');
      assert((await buttonLabel()) === 'Know it', `label is "${await buttonLabel()}"`);
    });
    await page.screenshot({ path: join(output, 'sparkle.png') });

    await check('a loader stays on the thumbnail after moving to another one', async () => {
      mock.nextDelayMs = 10_000;
      await button.click();
      await popover.getByText('Watching the video').waitFor({ timeout: 5000 });
      await page.keyboard.press('Escape');
      await secondCard.hover();
      await marker('loading').first().waitFor({ state: 'visible', timeout: 5000 });
      assert((await buttonLabel()) === 'Know it', `other video's button says "${await buttonLabel()}"`);

      const markerBox = await marker('loading').first().boundingBox();
      const cardBox = await firstCard.boundingBox();
      assert(
        markerBox.x >= cardBox.x && markerBox.x < cardBox.x + cardBox.width && markerBox.y >= cardBox.y && markerBox.y < cardBox.y + cardBox.height,
        `loader at ${JSON.stringify(markerBox)}, thumbnail at ${JSON.stringify(cardBox)}`,
      );
    });
    await page.screenshot({ path: join(output, 'loader.png') });

    await check('going back shows it is still loading', async () => {
      await firstCard.hover();
      await page.waitForTimeout(300);
      assert((await buttonLabel()) === 'Loading…', `button says "${await buttonLabel()}"`);
    });

    await check('the loader becomes a ready sparkle, which opens the answer', async () => {
      await secondCard.hover();
      await marker('ready').first().waitFor({ state: 'visible', timeout: 15_000 });
      const before = mock.requests.length;
      await page.screenshot({ path: join(output, 'ready-marker.png') });
      await marker('ready').first().click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 3000 });
      assert(mock.requests.length === before, 'opening a ready answer made a request');
      await page.keyboard.press('Escape');
      await firstCard.hover();
      await page.waitForTimeout(300);
      assert((await buttonLabel()) === 'See answer', `button says "${await buttonLabel()}"`);
    });

    console.log('Preparing answers in advance');
    const LONG_RESULTS = 'https://www.youtube.com/results?search_query=investing+podcast&sp=EgIYAg%253D%253D';
    const { usage: usageNow } = await getStorage('usage');
    const usageDay = usageNow.day;

    const openWithPrefetch = async (url, change = {}) => {
      await page.keyboard.press('Escape');
      await clearAnswers();
      await setStorage({ ...settingsWith(true), usage: { day: usageDay, seconds: 0 }, ...change });
      await page.mouse.move(2, 400);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (!url.includes('/watch')) await page.locator(THUMBNAILS).first().waitFor({ timeout: 30_000 });
    };
    const waitForRequests = async (from, count, timeout) => {
      const deadline = Date.now() + timeout;
      while (mock.requests.length - from < count && Date.now() < deadline) await page.waitForTimeout(250);
      return mock.requests.length - from;
    };

    await check('short on-screen videos get prepared, one at a time', async () => {
      const from = mock.requests.length;
      mock.defaultDelayMs = 1500;
      mock.maxInFlight = 0;
      await openWithPrefetch(SHORT_RESULTS);
      const count = await waitForRequests(from, 3, 40_000);
      assert(count >= 3, `only ${count} videos were prepared`);
      assert(mock.maxInFlight === 1, `${mock.maxInFlight} ran at once`);
      const ids = requestedIds(from);
      assert(new Set(ids).size === ids.length, 'a video was prepared twice');
      for (const request of mock.requests.slice(from)) {
        const length = request.body.contents[0].parts[1].text.match(/Length: ([\d:]+)/)?.[1];
        const seconds = length?.split(':').reduce((total, part) => total * 60 + Number(part), 0);
        assert(seconds === undefined || seconds < 540, `prepared a video of ${length}`);
      }
      console.log(`        prepared ${count}, at most ${mock.maxInFlight} at once`);
    });
    await page.screenshot({ path: join(output, 'prepared.png') });

    await check('a prepared answer opens instantly, with no new request', async () => {
      await marker('ready').first().waitFor({ state: 'visible', timeout: 15_000 });
      const before = requestedIds().length;
      const started = Date.now();
      await marker('ready').first().click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 3000 });
      console.log(`        opened in ${Date.now() - started}ms`);
      assert((await popover.getByText('Watching the video').count()) === 0, 'still loading');
      assert(requestedIds().length <= before + 1, 'opening made extra requests');
      await page.keyboard.press('Escape');
    });

    await check('clicking a video while it is being prepared joins the same request', async () => {
      mock.defaultDelayMs = 4000;
      const from = mock.requests.length;
      await openWithPrefetch(SHORT_RESULTS);
      await marker('loading').first().waitFor({ state: 'visible', timeout: 25_000 });
      await marker('loading').first().click();
      await popover.getByText('Watching the video').waitFor({ timeout: 3000 });
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 10_000 });
      const ids = requestedIds(from);
      assert(new Set(ids).size === ids.length, 'the same video was requested twice');
      await page.keyboard.press('Escape');
    });
    mock.defaultDelayMs = 0;

    await check('long videos are never prepared', async () => {
      const from = mock.requests.length;
      await openWithPrefetch(LONG_RESULTS);
      await page.waitForTimeout(8000);
      const prompts = mock.requests.slice(from).map((request) => request.body.contents[0].parts[1].text.match(/Length: ([\d:]+)/)?.[1]);
      const tooLong = prompts.filter((length) => length && length.split(':').reduce((total, part) => total * 60 + Number(part), 0) >= 540);
      assert(tooLong.length === 0, `prepared videos of ${tooLong.join(', ')}`);
      console.log(`        ${prompts.length} under-9-minute videos prepared on a page of long ones`);
    });

    await check('preparing stops at 4 hours, but clicks still work', async () => {
      const from = mock.requests.length;
      await openWithPrefetch(SHORT_RESULTS, { usage: { day: usageDay, seconds: 4 * 3600 } });
      await page.waitForTimeout(7000);
      assert(mock.requests.length === from, `${mock.requests.length - from} prepared past the budget`);
      const [card] = await onScreenThumbnails();
      await card.hover();
      await button.click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 10_000 });
      assert(mock.requests.length === from + 1, 'click did not make one request');
    });

    await check('preparing backs off after a rate limit', async () => {
      const from = mock.requests.length;
      mock.nextError = { status: 429, message: 'Quota exceeded' };
      await openWithPrefetch(SHORT_RESULTS);
      assert((await waitForRequests(from, 1, 15_000)) === 1, 'nothing was tried');
      await page.waitForTimeout(8000);
      assert(mock.requests.length === from + 1, `${mock.requests.length - from - 1} more after the rate limit`);
      assert((await page.locator('know-it-root .popover.visible').count()) === 0, 'an error popped up by itself');
    });

    await check('turning it off in settings stops it', async () => {
      const from = mock.requests.length;
      await openWithPrefetch(SHORT_RESULTS, settingsWith(false));
      await page.waitForTimeout(7000);
      assert(mock.requests.length === from, 'videos were prepared while turned off');
    });

    await check('nothing is prepared while watching a video', async () => {
      const from = mock.requests.length;
      await openWithPrefetch(`https://www.youtube.com/watch?v=${videoId}`);
      await page.waitForTimeout(7000);
      assert(mock.requests.length === from, `${mock.requests.length - from} prepared from the watch page`);
    });

    thumb = null;
  } finally {
    await context.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
