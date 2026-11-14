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

// ---- Mock Gemini, and the remote config file ----

/** Different from the built-in names, to show the remote file is read and used. */
const REMOTE = {
  models: { auto: 'gemini-mock-auto', fallback: 'gemini-mock-fallback' },
  notice: { id: 'e2e', text: 'Mock notice from the remote config.' },
};

const mock = { requests: [], nextDelayMs: 0, nextError: null, defaultDelayMs: 0, inFlight: 0, maxInFlight: 0, configFetches: 0 };

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', async () => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.url === '/remote-config.json') {
      mock.configFetches++;
      return send(200, REMOTE);
    }
    if (req.headers['x-goog-api-key'] !== FAKE_KEY) {
      return send(400, { error: { message: 'API key not valid. Please pass a valid API key.' } });
    }
    if (req.method === 'GET') {
      return send(200, {
        models: [
          { name: 'models/gemini-mock-auto', displayName: 'Mock Flash-Lite', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-9-flash', displayName: 'Gemini 9 Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-9-flash-image', displayName: 'Image', supportedGenerationMethods: ['generateContent'] },
        ],
      });
    }

    const body = JSON.parse(raw);
    mock.requests.push({ url: req.url, body, at: Date.now() });

    const delay = mock.nextDelayMs || mock.defaultDelayMs;
    const error = mock.nextError;
    mock.nextDelayMs = 0;
    // `times` makes the fallback model fail too.
    if (error?.times > 1) mock.nextError = { ...error, times: error.times - 1 };
    else mock.nextError = null;
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
    const panelUrl = `chrome-extension://${extensionId}/panel.html`;

    // The welcome tab opens by itself on install.
    let welcome = context.pages().find((p) => p.url().startsWith(panelUrl));
    for (let waited = 0; !welcome && waited < 5000; waited += 250) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      welcome = context.pages().find((p) => p.url().startsWith(panelUrl));
    }
    const page = context.pages().find((p) => !p.url().startsWith('chrome-extension://')) ?? (await context.newPage());
    activePage = page;

    const button = page.locator('know-it-root .know-it');
    const popover = page.locator('know-it-root .popover');
    const pageButton = page.locator('know-it-root .page-know');
    const autoSwitch = page.locator('know-it-root .pagebar .auto');
    const toast = page.locator('know-it-root .toast');
    /** Real results pages can still be shifting, leaving the pointer off the card until it moves again. */
    const hoverUntilButton = async (link) => {
      await link.hover();
      await button.waitFor({ state: 'visible', timeout: 1500 }).catch(() => link.hover({ position: { x: 20, y: 60 } }));
      await button.waitFor({ state: 'visible', timeout: 5000 });
    };
    const setStorage = (items) => worker.evaluate((value) => chrome.storage.local.set(value), items);
    const getStorage = (key) => worker.evaluate((name) => chrome.storage.local.get(name), key);
    const settingsWith = (change = {}) => ({
      settings: { apiKey: FAKE_KEY, model: 'auto', language: 'english', autoAnswer: false, notifications: true, version: 2, ...change },
    });
    const updateStats = (change) =>
      worker.evaluate(async (value) => {
        const { stats } = await chrome.storage.local.get('stats');
        await chrome.storage.local.set({ stats: { ...stats, ...value } });
      }, change);
    const videoIdOf = (href) => {
      const url = new URL(href, 'https://www.youtube.com');
      return url.searchParams.get('v') ?? url.pathname.split('/')[2];
    };
    const requestedIds = (from = 0) => mock.requests.slice(from).map((request) => videoIdOf(request.body.contents[0].parts[0].fileData.fileUri));
    const waitForRequests = async (from, count, timeout) => {
      const deadline = Date.now() + timeout;
      while (mock.requests.length - from < count && Date.now() < deadline) await page.waitForTimeout(250);
      return mock.requests.length - from;
    };
    /** Records whether the popover ever shows the loading state, so a saved answer can be checked for a flash. */
    const watchForLoading = () =>
      page.evaluate(() => {
        const shadow = document.querySelector('know-it-root').shadowRoot;
        window.__sawLoading = false;
        window.__loadingWatch?.disconnect();
        window.__loadingWatch = new MutationObserver(() => {
          if (shadow.querySelector('.popover.visible .loading')) window.__sawLoading = true;
        });
        window.__loadingWatch.observe(shadow, { subtree: true, childList: true, attributes: true });
      });
    const sawLoading = () => page.evaluate(() => window.__sawLoading);

    console.log('Install and the toolbar panel');
    await check('installing opens a welcome tab with the key steps', async () => {
      assert(welcome, 'no welcome tab opened');
      await welcome.locator('#welcome').waitFor({ state: 'visible', timeout: 5000 });
      await welcome.locator('#setup').waitFor({ state: 'visible', timeout: 5000 });
      await welcome.getByRole('link', { name: 'Get your free key' }).waitFor({ timeout: 2000 });
    });
    await check('the remote config file is read', async () => {
      for (let waited = 0; mock.configFetches === 0 && waited < 8000; waited += 250) await page.waitForTimeout(250);
      assert(mock.configFetches >= 1, 'never fetched');
      const { remote } = await getStorage('remote');
      assert(remote?.ok === true, JSON.stringify(remote));
    });
    await check('a wrong key is refused in the panel', async () => {
      await welcome.locator('#key-form input').fill('wrong-key');
      await welcome.locator('#key-form').getByRole('button', { name: 'Save and test' }).click();
      await welcome.locator('#key-form .key-status.bad').waitFor({ timeout: 5000 });
      const { settings } = await getStorage('settings');
      assert(!settings?.apiKey, 'a refused key was saved');
    });
    await welcome?.screenshot({ path: join(output, 'panel-welcome.png'), fullPage: true });
    await welcome?.close();

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

    await check('without a key, setup appears in the popover and sends nothing', async () => {
      await button.click();
      await popover.locator('iframe.setup-frame').waitFor({ timeout: 5000 });
      await page.frameLocator('know-it-root iframe.setup-frame').getByRole('link', { name: 'Get your free key' }).waitFor({ timeout: 5000 });
      assert(mock.requests.length === 0, 'a request was sent');
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(output, 'setup-popover.png') });

    await check('the page cannot read the key field, which is in the extension’s own frame', async () => {
      const readable = await page.evaluate(() => {
        const frame = document.querySelector('know-it-root').shadowRoot.querySelector('iframe.setup-frame');
        try {
          return !!frame.contentDocument?.querySelector('input');
        } catch {
          return false;
        }
      });
      assert(!readable, 'YouTube could read the frame');
    });

    await check('saving the key in the popover answers the clicked video', async () => {
      const frame = page.frameLocator('know-it-root iframe.setup-frame');
      await frame.locator('input[type=password]').fill(FAKE_KEY);
      await frame.getByRole('button', { name: 'Save and test' }).click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 15_000 });
      assert(page.url() === startUrl, `page moved to ${page.url()}`);
      assert(mock.requests.length === 1, `${mock.requests.length} requests`);
      const { settings } = await getStorage('settings');
      assert(settings.apiKey === FAKE_KEY, 'key not saved');
    });
    await page.screenshot({ path: join(output, 'answer.png') });

    await check('the request uses the automatic model from the remote config', async () => {
      assert(mock.requests[0].url.includes(`models/${REMOTE.models.auto}:`), mock.requests[0].url);
    });

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
      assert((await popover.locator('.points mark').count()) === 0, 'key points are highlighted too');
      assert((await popover.locator('.points strong').first().textContent()) === '₹4.25 Cr', 'key words in points are not bolder');
      assert(!(await popover.textContent()).includes('**'), 'asterisks are showing');
    });

    await check('summary expands without another request', async () => {
      await popover.getByRole('button', { name: 'Summary' }).click();
      await popover.getByText('Second mock point').waitFor({ timeout: 2000 });
      assert(mock.requests.length === 1, 'summary made a request');
    });
    await page.screenshot({ path: join(output, 'summary.png') });

    await check('timestamp link and misleading-title warning show', async () => {
      const link = popover.getByRole('link', { name: /Check it at 0:30/ });
      assert((await link.getAttribute('href')).endsWith(`v=${videoId}&t=30s`), await link.getAttribute('href'));
      await popover.locator('.caution', { hasText: "Doesn't deliver" }).waitFor({ timeout: 2000 });
      await popover.locator('.caution', { hasText: 'may be a guess' }).waitFor({ timeout: 2000 });
      assert((await popover.locator('.chip, .question').count()) === 0, 'chips or the question still show');
    });

    await check('Escape closes the popover', async () => {
      await page.keyboard.press('Escape');
      await popover.waitFor({ state: 'hidden', timeout: 2000 });
    });

    await check('reopening uses the saved answer, with no loading flash', async () => {
      await watchForLoading();
      await thumb.hover();
      await button.click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 5000 });
      await popover.getByRole('button', { name: 'Ask again' }).waitFor({ timeout: 2000 });
      assert(mock.requests.length === 1, 'cached answer made a request');
      assert(!(await sawLoading()), 'the loading state flashed');
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
      mock.nextError = { status: 429, message: 'Quota exceeded', times: 2 };
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

    await check('a busy model switches to the fallback named in the remote config', async () => {
      const before = mock.requests.length;
      mock.nextError = { status: 503, message: 'This model is currently experiencing high demand.' };
      await answerFresh();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 10_000 });
      const urls = mock.requests.slice(before).map((request) => request.url);
      assert(urls.length === 2 && urls[0].includes(REMOTE.models.auto) && urls[1].includes(REMOTE.models.fallback), urls.join(', '));
    });
    await page.keyboard.press('Escape');

    await check('a pinned model is used, with the automatic one as its fallback', async () => {
      await setStorage(settingsWith({ model: 'gemini-pinned-flash' }));
      const before = mock.requests.length;
      mock.nextError = { status: 404, message: 'models/gemini-pinned-flash is not found for API version v1beta' };
      await answerFresh();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 10_000 });
      const urls = mock.requests.slice(before).map((request) => request.url);
      assert(urls.length === 2 && urls[0].includes('gemini-pinned-flash') && urls[1].includes(REMOTE.models.auto), urls.join(', '));
      await setStorage(settingsWith());
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
      // YouTube's preview player can cover a thumbnail for a moment, but the extension must never block a click.
      await thumb.click({ timeout: 10_000 }).catch(async (err) => {
        const blocker = err.message.split('\n').find((line) => line.includes('intercepts pointer events'));
        console.log(`        first click was blocked: ${blocker?.trim().slice(0, 160) ?? err.message.split('\n')[0]}`);
        assert(!blocker?.includes('know-it-root'), 'the extension blocked a click on a thumbnail');
        await page.mouse.move(2, 400);
        await page.waitForTimeout(1000);
        await thumb.click({ timeout: 15_000 });
      });
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
      await hoverUntilButton(shorts.first());
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
      await hoverUntilButton(live);
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
    const clearAnswers = () =>
      worker.evaluate(async () => {
        const all = await chrome.storage.local.get(null);
        await chrome.storage.local.remove(Object.keys(all).filter((key) => key.startsWith('answer:')));
      });
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
    await setStorage(settingsWith());
    await page.goto(SHORT_RESULTS, { waitUntil: 'domcontentloaded' });
    await page.locator(THUMBNAILS).first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2000);
    // Tall ads or shelves can leave fewer than two whole thumbnails on screen, so scroll until there are.
    let cards = await onScreenThumbnails();
    for (let tries = 0; cards.length < 2 && tries < 6; tries++) {
      await page.evaluate(() => window.scrollBy(0, 250));
      await page.waitForTimeout(500);
      cards = await onScreenThumbnails();
    }
    const [firstCard, secondCard] = cards;

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

    const LONG_RESULTS = 'https://www.youtube.com/results?search_query=investing+podcast&sp=EgIYAg%253D%253D';

    console.log('Reopening while loading, failures and scrolling away');
    await page.keyboard.press('Escape');
    await clearAnswers();
    await page.mouse.move(2, 400);
    await page.waitForTimeout(500);
    cards = await onScreenThumbnails();
    const [cardA, cardB] = cards;

    await check('reopening while it loads carries on the timer, with no second request', async () => {
      const before = mock.requests.length;
      mock.nextDelayMs = 9000;
      await cardA.hover();
      await button.click();
      await popover.getByText('Watching the video').waitFor({ timeout: 5000 });
      await page.waitForTimeout(3500);
      await page.keyboard.press('Escape');
      await cardA.hover();
      await button.click();
      const text = await popover.locator('.loading').textContent({ timeout: 3000 });
      const seconds = Number(text.match(/(\d+)s/)?.[1] ?? 0);
      assert(seconds >= 3, `timer shows "${text}"`);
      assert(mock.requests.length === before + 1, `${mock.requests.length - before} requests`);
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 15_000 });
    });
    await page.keyboard.press('Escape');

    await check('a failure stays on the thumbnail and is not asked again by itself', async () => {
      const before = mock.requests.length;
      mock.nextDelayMs = 1500;
      mock.nextError = { status: 429, message: 'Quota exceeded', times: 2 };
      await cardB.hover();
      await button.click();
      await popover.getByText('Watching the video').waitFor({ timeout: 5000 });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(3000);
      await cardA.hover();
      await marker('failed').first().waitFor({ state: 'visible', timeout: 5000 });
      await page.screenshot({ path: join(output, 'failed-marker.png') });
      await cardB.hover();
      await button.click();
      await popover.getByText('free-tier limit').waitFor({ timeout: 5000 });
      // Two requests: the model, then its fallback.
      assert(mock.requests.length === before + 2, `${mock.requests.length - before} requests before reopening`);
      await popover.getByRole('button', { name: 'Try again' }).click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 10_000 });
      assert(mock.requests.length === before + 3, 'Try again did not ask once');
    });
    await page.keyboard.press('Escape');
    // The failed answer also announced itself, since the popover was closed.
    await page.evaluate(() => document.querySelector('know-it-root').shadowRoot.querySelectorAll('.toast').forEach((t) => t.remove()));

    await check('scrolling the video away closes the popover, and the answer arrives as a toast', async () => {
      await clearAnswers();
      mock.nextDelayMs = 4000;
      await cardA.scrollIntoViewIfNeeded();
      await cardA.hover();
      await button.click();
      await popover.getByText('Watching the video').waitFor({ timeout: 5000 });
      await page.evaluate(() => window.scrollBy(0, 2500));
      await popover.waitFor({ state: 'hidden', timeout: 3000 });
      await toast.filter({ hasText: 'MOCK ANSWER' }).first().waitFor({ state: 'visible', timeout: 10_000 });
      await page.screenshot({ path: join(output, 'toast.png') });
      await toast.filter({ hasText: 'MOCK ANSWER' }).first().click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 3000 });
    });
    await page.keyboard.press('Escape');

    await check('nothing is sent while browsing, without a click', async () => {
      await clearAnswers();
      const from = mock.requests.length;
      await page.goto(SHORT_RESULTS, { waitUntil: 'domcontentloaded' });
      await page.locator(THUMBNAILS).first().waitFor({ timeout: 30_000 });
      for (let i = 0; i < 3; i++) {
        await page.waitForTimeout(2500);
        await page.evaluate(() => window.scrollBy(0, 500));
      }
      assert(mock.requests.length === from, `${mock.requests.length - from} requests while browsing`);
    });

    console.log('Notifications');
    // Headless Chrome reports every tab as visible, so these close the tab instead: nobody is there to see the answer.
    const askThenCloseTab = async () => {
      const other = await context.newPage();
      await other.goto(SHORT_RESULTS, { waitUntil: 'domcontentloaded' });
      await other.locator(THUMBNAILS).first().waitFor({ timeout: 30_000 });
      await other.waitForTimeout(1500);
      const link = other.locator(THUMBNAILS).first();
      const id = videoIdOf(await link.getAttribute('href'));
      await clearAnswers();
      mock.nextDelayMs = 3000;
      await link.hover();
      await other.locator('know-it-root .know-it').click({ timeout: 5000 });
      await other.locator('know-it-root .popover').getByText('Watching the video').waitFor({ timeout: 5000 });
      await other.close();
      await page.waitForTimeout(5000);
      return id;
    };
    const notifications = () => worker.evaluate(async () => Object.keys(await chrome.notifications.getAll()));

    await check('an answer nobody is there to see raises a notification and a badge', async () => {
      const id = await askThenCloseTab();
      const found = await notifications();
      const badge = await worker.evaluate(() => chrome.action.getBadgeText({}));
      assert(found.includes(`answer:${id}`), `notifications: ${found.join(', ') || 'none'}`);
      assert(Number(badge) >= 1, `badge is "${badge}"`);
    });

    await check('notifications can be turned off', async () => {
      await worker.evaluate(async () => {
        for (const id of Object.keys(await chrome.notifications.getAll())) await chrome.notifications.clear(id);
      });
      await setStorage(settingsWith({ notifications: false }));
      await askThenCloseTab();
      const found = await notifications();
      await setStorage(settingsWith());
      assert(found.length === 0, `notifications: ${found.join(', ')}`);
    });

    console.log('A video’s own page');
    const shortIds = [];
    for (const link of await onScreenThumbnails()) {
      const id = videoIdOf(await link.getAttribute('href'));
      if ((await link.getAttribute('href')).includes('/watch')) shortIds.push(id);
    }
    for (let tries = 0; shortIds.length < 4 && tries < 5; tries++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await page.waitForTimeout(800);
      for (const link of await onScreenThumbnails()) {
        const linkHref = await link.getAttribute('href');
        const id = videoIdOf(linkHref);
        if (linkHref.includes('/watch') && !shortIds.includes(id)) shortIds.push(id);
      }
    }
    console.log(`        ${shortIds.length} short videos to open`);
    await clearAnswers();
    const watch = async (id) => {
      await page.goto(`https://www.youtube.com/watch?v=${id}`, { waitUntil: 'domcontentloaded' });
      await page.locator('ytd-watch-metadata h1').first().waitFor({ timeout: 30_000 });
    };

    await check('the button sits in YouTube’s row of actions, just left of Like', async () => {
      await watch(shortIds[0]);
      await pageButton.waitFor({ state: 'visible', timeout: 10_000 });
      await page.locator('ytd-watch-metadata #actions button').first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(1500);
      const bar = await page.locator('know-it-root .pagebar').boundingBox();
      const first = await page.evaluate(() => {
        const rects = [...document.querySelectorAll('ytd-watch-metadata #actions button')].map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0);
        const r = rects.reduce((a, b) => (b.left < a.left ? b : a));
        return { left: r.left, middle: r.top + r.height / 2 };
      });
      const owner = await page.locator('ytd-watch-metadata #owner').first().boundingBox();
      const gap = first.left - (bar.x + bar.width);
      assert(gap >= 4 && gap <= 20, `gap to the first action is ${gap}px`);
      assert(Math.abs(bar.y + bar.height / 2 - first.middle) <= 4, `not level with the row: ${JSON.stringify(bar)} vs ${first.middle}`);
      assert(bar.x >= owner.x + owner.width, 'covers the channel or Subscribe');
      await autoSwitch.waitFor({ state: 'visible', timeout: 2000 });
      assert((await autoSwitch.getAttribute('aria-checked')) === 'false', 'auto is on by default');
    });
    await page.screenshot({ path: join(output, 'watch-button.png') });

    await check('the page button answers the open video', async () => {
      const before = mock.requests.length;
      await pageButton.click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 15_000 });
      assert(requestedIds(before)[0] === shortIds[0], `asked about ${requestedIds(before)[0]}`);
      await popover.getByRole('button', { name: "Today's answers" }).waitFor({ timeout: 2000 });
    });
    await page.screenshot({ path: join(output, 'watch-answer.png') });

    await check('Jump to moves the player instead of opening a tab', async () => {
      const link = popover.getByRole('link', { name: /Jump to 0:30/ });
      await link.waitFor({ timeout: 2000 });
      const advert = await page.locator('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting').count();
      if (advert) {
        console.log('        an advert is playing, so this falls back to a tab');
        return;
      }
      const pagesBefore = context.pages().length;
      await link.click();
      await page.waitForTimeout(800);
      const time = await page.evaluate(() => document.querySelector('video.html5-main-video')?.currentTime ?? -1);
      assert(context.pages().length === pagesBefore, 'a tab opened');
      assert(time >= 29 && time < 40, `player is at ${time}`);
    });
    await page.keyboard.press('Escape');

    await check('after the third page click, it offers to answer opened videos automatically', async () => {
      await updateStats({ pageClicks: 2, autoOfferDone: false });
      await pageButton.click();
      await popover.getByRole('button', { name: 'Turn on' }).waitFor({ timeout: 5000 });
      await page.screenshot({ path: join(output, 'auto-offer.png') });
      await popover.getByRole('button', { name: 'Turn on' }).click();
      await popover.getByText('On. Answers will appear').waitFor({ timeout: 2000 });
      const { settings } = await getStorage('settings');
      assert(settings.autoAnswer === true, 'not turned on');
      assert((await autoSwitch.getAttribute('aria-checked')) === 'true', 'switch did not follow');
    });
    await page.keyboard.press('Escape');

    await check('the offer is not made again', async () => {
      await pageButton.click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 5000 });
      assert((await popover.getByRole('button', { name: 'Turn on' }).count()) === 0, 'offered again');
    });
    await page.keyboard.press('Escape');

    await check('with auto on, opening a short video answers it after 5 seconds, as a toast', async () => {
      const from = mock.requests.length;
      const opened = Date.now();
      await watch(shortIds[1]);
      assert((await waitForRequests(from, 1, 15_000)) === 1, 'nothing was asked');
      const delay = mock.requests[from].at - opened;
      assert(delay >= 5000, `asked after ${delay}ms`);
      assert(requestedIds(from)[0] === shortIds[1], 'asked about the wrong video');
      await toast.filter({ hasText: 'MOCK ANSWER' }).first().waitFor({ state: 'visible', timeout: 10_000 });
      console.log(`        asked ${Math.round(delay / 100) / 10}s after opening`);
    });
    await page.screenshot({ path: join(output, 'auto-toast.png') });

    await check('the page button then opens the automatic answer for free', async () => {
      const before = mock.requests.length;
      await watchForLoading();
      await pageButton.click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 3000 });
      assert(mock.requests.length === before, 'asked again');
      assert(!(await sawLoading()), 'the loading state flashed');
    });
    await page.keyboard.press('Escape');

    await check('auto stops at 4 hours of the day', async () => {
      const { usage } = await getStorage('usage');
      await setStorage({ usage: { day: usage.day, seconds: 4 * 3600 } });
      const from = mock.requests.length;
      await watch(shortIds[2]);
      await page.waitForTimeout(8000);
      assert(mock.requests.length === from, 'asked past the budget');
      await setStorage({ usage });
    });

    await check('the switch beside the button turns auto off', async () => {
      await autoSwitch.click();
      await page.waitForTimeout(300);
      const { settings } = await getStorage('settings');
      assert(settings.autoAnswer === false, 'still on');
      const from = mock.requests.length;
      await watch(shortIds[3] ?? shortIds[0]);
      await page.waitForTimeout(8000);
      assert(mock.requests.length === from, 'asked while off');
    });

    await check('auto skips videos over 30 minutes without asking Gemini', async () => {
      await setStorage(settingsWith({ autoAnswer: true }));
      await page.goto(LONG_RESULTS, { waitUntil: 'domcontentloaded' });
      await page.locator(THUMBNAILS).first().waitFor({ timeout: 30_000 });
      const longId = videoIdOf(await page.locator('a[href*="/watch?v="]:has(img), a[href*="/watch?v="]:has(yt-thumbnail-view-model)').first().getAttribute('href'));
      const from = mock.requests.length;
      await watch(longId);
      await page.waitForTimeout(9000);
      assert(mock.requests.length === from, `asked about a long video (${requestedIds(from).join(', ')})`);
      await setStorage(settingsWith());
    });

    console.log('Shorts player');
    await check('a Short being watched gets its own button, without the auto switch', async () => {
      await page.goto('https://www.youtube.com/results?search_query=stock+market+shorts', { waitUntil: 'domcontentloaded' });
      const shorts = page.locator('a[href^="/shorts/"]:has(img), a[href^="/shorts/"]:has(yt-thumbnail-view-model)');
      await shorts.first().waitFor({ timeout: 30_000 });
      const shortId = (await shorts.first().getAttribute('href')).split('/')[2].split('?')[0];
      await page.goto(`https://www.youtube.com/shorts/${shortId}`, { waitUntil: 'domcontentloaded' });
      await pageButton.waitFor({ state: 'visible', timeout: 15_000 });
      assert(!(await autoSwitch.isVisible()), 'auto switch shows on Shorts');
      const player = await page.locator('#shorts-player').first().boundingBox();
      const box = await pageButton.boundingBox();
      assert(box.x >= player.x && box.x + box.width <= player.x + player.width && box.y >= player.y + 64 && box.y < player.y + 140, `button ${JSON.stringify(box)}, player ${JSON.stringify(player)}`);
      const before = mock.requests.length;
      await pageButton.click();
      await popover.getByText('MOCK ANSWER').waitFor({ timeout: 15_000 });
      assert(requestedIds(before)[0] === shortId, `asked about ${requestedIds(before)[0]}`);
    });
    await page.screenshot({ path: join(output, 'shorts-player.png') });
    await page.keyboard.press('Escape');

    console.log('Top bar button');
    await check('a button in YouTube’s top bar opens today’s answers on the page', async () => {
      await page.goto(SHORT_RESULTS, { waitUntil: 'domcontentloaded' });
      const top = page.locator('know-it-root .topbar-button');
      await top.waitFor({ state: 'visible', timeout: 15_000 });
      const box = await top.boundingBox();
      const mic = await page.locator('ytd-masthead #voice-search-button').first().boundingBox();
      assert(box.x > mic.x + mic.width && box.x - (mic.x + mic.width) < 20, `button ${JSON.stringify(box)}, mic ${JSON.stringify(mic)}`);
      await top.click();
      const list = page.frameLocator('know-it-root .drawer iframe');
      await list.locator('#answers h2').waitFor({ timeout: 5000 });
      await page.screenshot({ path: join(output, 'topbar-drawer.png') });
      await list.locator('#close').click();
      await page.locator('know-it-root .drawer').waitFor({ state: 'hidden', timeout: 3000 });
    });

    console.log('Toolbar panel');
    const panel = await context.newPage();
    await check('the panel shows today’s saved time and answers, not time left', async () => {
      await updateStats({ answers: 12, sponsorShown: 0, sponsorLastShown: 0, sponsorDone: false });
      await panel.setViewportSize({ width: 380, height: 640 });
      await panel.goto(panelUrl);
      await panel.locator('#list .item').first().waitFor({ timeout: 5000 });
      assert(/\d+ min saved today/.test(await panel.locator('#saved-today').textContent()), `saved today reads "${await panel.locator('#saved-today').textContent()}"`);
      assert(await panel.locator('#limit-note').isHidden(), 'time left shows while plenty is left');
      assert((await panel.locator('#setup').isVisible()) === false, 'setup shows with a key saved');
      const first = panel.locator('#list .item').first();
      assert((await first.locator('a.item-title').getAttribute('href')).includes('watch?v='), 'title is not a link');
      await first.locator('.expand').click();
      await first.locator('.details').getByText('First key point').waitFor({ timeout: 2000 });
      console.log(`        ${await panel.locator('#list .item').count()} answers listed`);
    });
    await check('the panel shows the remote notice and the sponsor line once earned', async () => {
      await panel.locator('#notice', { hasText: 'Mock notice' }).waitFor({ state: 'visible', timeout: 2000 });
      await panel.locator('#nudge').waitFor({ state: 'visible', timeout: 2000 });
      await panel.locator('#nudge-close').click();
      const { stats } = await getStorage('stats');
      assert(stats.sponsorDone === true, 'dismissing did not stick');
    });
    await panel.screenshot({ path: join(output, 'panel.png'), fullPage: true });
    await check('the footer stays in view and the long answers are cut short', async () => {
      const footer = await panel.locator('footer').boundingBox();
      const height = await panel.evaluate(() => window.innerHeight);
      assert(footer && footer.y + footer.height <= height + 1, `footer is out of view at ${footer?.y}`);
      const clamped = await panel.locator('.item:not(.open) .item-answer').first().evaluate((node) => getComputedStyle(node).webkitLineClamp);
      assert(clamped === '3', `answer not clamped: ${clamped}`);
    });
    await check('Settings replace the list and hold Auto, the masked key and the live model list', async () => {
      await panel.locator('#settings-toggle').click();
      assert(await panel.locator('#list').isHidden(), 'the list still shows under Settings');
      assert(await panel.locator('#auto').isVisible(), 'no Auto switch in Settings');
      assert(!(await panel.locator('#key-mask').textContent()).includes(FAKE_KEY), 'key shown in full');
      await panel.locator('#advanced-toggle').click();
      await panel.locator('#model option[value="gemini-9-flash"]').waitFor({ state: 'attached', timeout: 5000 });
      assert((await panel.locator('#model option[value="gemini-9-flash-image"]').count()) === 0, 'an image model is offered');
      assert((await panel.locator('#version').textContent()).includes('1.1.0'), 'no version');
    });
    await panel.screenshot({ path: join(output, 'panel-more.png'), fullPage: true });
    await panel.emulateMedia({ colorScheme: 'dark' });
    await panel.screenshot({ path: join(output, 'panel-dark.png'), fullPage: true });
    await check('clearing empties the list', async () => {
      panel.once('dialog', (dialog) => dialog.accept());
      await panel.locator('#clear').click();
      await panel.locator('#settings-back').click();
      await panel.locator('#empty').waitFor({ state: 'visible', timeout: 5000 });
    });
    await panel.close();

    console.log('Update');
    await check('a newer copy added to an open tab takes over from the old one, as after an update', async () => {
      await page.goto('https://www.youtube.com/results?search_query=weekend+investing', { waitUntil: 'domcontentloaded' });
      await page.locator('know-it-root .topbar-button').waitFor({ state: 'visible', timeout: 15000 });
      // Marks the copy running now, to tell it apart from the one added next.
      await page.evaluate(() => document.querySelector('know-it-root').setAttribute('data-old', ''));
      // What the service worker does for open YouTube tabs after an install or update.
      // (Headless Chrome can't reload an extension loaded from the command line, so the update itself isn't run.)
      await worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
        await Promise.all(tabs.map((tab) => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })));
      });
      await page.waitForFunction(() => document.querySelectorAll('know-it-root').length === 1 && !document.querySelector('know-it-root[data-old]'), null, { timeout: 10000 });
      const fresh = await firstThumbnail(page);
      await hoverUntilButton(fresh);
      await button.click();
      await popover.waitFor({ state: 'visible', timeout: 5000 });
      await page.locator('know-it-root .popover .answer, know-it-root .popover .loading').first().waitFor({ timeout: 10000 });
      assert((await page.locator('know-it-root').count()) === 1, 'more than one copy on the page');
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
