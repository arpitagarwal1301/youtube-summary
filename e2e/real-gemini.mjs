// Runs the production build on real YouTube with the real Gemini, using the key in .env.local.
// Uses one short video from the daily quota. The key is only placed in a temporary browser profile.
// With --prefetch, it instead lets advance preparation run for 90 seconds on a page of short videos.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO_ID = 'n6OVJf7MnFc';
const SEARCH = 'https://www.youtube.com/results?search_query=Pristine+Amore+Kalyani+Nagar+HOMES4U';
const SHORT_VIDEOS = 'https://www.youtube.com/results?search_query=stock+market+explained&sp=EgIYAQ%253D%253D';
const PREFETCH_TEST_MS = 90_000;
const prefetchMode = process.argv.includes('--prefetch');

const env = await readFile(join(root, '.env.local'), 'utf8').catch(() => '');
const apiKey = env.match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim();
if (!apiKey) {
  console.error('Add GEMINI_API_KEY=your-key to .env.local first.');
  process.exit(1);
}

execFileSync('node', ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' });
await mkdir(join(root, 'e2e/output'), { recursive: true });

const extension = join(root, 'dist');
const profile = await mkdtemp(join(tmpdir(), 'know-it-real-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1400, height: 900 },
  locale: 'en-US',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});

let failed = false;
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async ([key, prefetch]) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, apiKey: key, prefetch } });
  }, [apiKey, prefetchMode]);

  const page = context.pages()[0];

  if (prefetchMode) {
    await page.goto(SHORT_VIDEOS, { waitUntil: 'domcontentloaded' });
    const ready = page.locator('know-it-root .marker[data-status="ready"]');
    const startedAt = Date.now();
    let lastCount = -1;
    while (Date.now() - startedAt < PREFETCH_TEST_MS) {
      const count = await ready.count();
      if (count !== lastCount) {
        console.log(`After ${Math.round((Date.now() - startedAt) / 1000)}s: ${count} answers ready`);
        lastCount = count;
      }
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: join(root, 'e2e/output/real-prepared.png') });

    const { usage } = await worker.evaluate(() => chrome.storage.local.get('usage'));
    console.log(`Counted towards the daily limit: ${usage?.seconds ?? 0}s`);
    if ((await ready.count()) === 0) throw new Error('no answers were prepared');

    const started = Date.now();
    await ready.first().click();
    await page.locator('know-it-root .popover .answer').waitFor({ timeout: 5000 });
    console.log(`A prepared answer opened in ${Date.now() - started}ms`);
    console.log(`Answer: ${await page.locator('know-it-root .popover .answer').textContent()}`);
    await page.screenshot({ path: join(root, 'e2e/output/real-prepared-answer.png') });
    await context.close();
    await rm(profile, { recursive: true, force: true });
    process.exit(0);
  }

  await page.goto(SEARCH, { waitUntil: 'domcontentloaded' });

  const thumbnail = page.locator(`a[href*="${VIDEO_ID}"]:has(img), a[href*="${VIDEO_ID}"]:has(yt-thumbnail-view-model)`).first();
  await thumbnail.waitFor({ timeout: 30_000 });
  await thumbnail.scrollIntoViewIfNeeded();
  await thumbnail.hover();

  const button = page.locator('know-it-root .know-it');
  const popover = page.locator('know-it-root .popover');
  await button.click({ timeout: 10_000 });

  const startedAt = Date.now();
  const outcome = popover.locator('.answer, .error');
  await outcome.first().waitFor({ timeout: 280_000 });
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  await page.screenshot({ path: join(root, 'e2e/output/real-gemini.png') });

  if (await popover.locator('.error').count()) {
    failed = true;
    console.log(`FAILED after ${seconds}s: ${await popover.locator('.error').textContent()}`);
  } else {
    console.log(`Answered through the extension in ${seconds}s`);
    console.log(`Question: ${await popover.locator('.question').textContent()}`);
    console.log(`Answer: ${await popover.locator('.answer').textContent()}`);
    console.log(`Key points: ${(await popover.locator('.points li').allTextContents()).join(' | ')}`);
    console.log(`Highlighted: ${(await popover.locator('mark').allTextContents()).join(' | ')}`);
    console.log(`Tags: ${(await popover.locator('.chip').allTextContents()).join(', ')}`);
    console.log(`Link: ${await popover.locator('a.evidence').getAttribute('href').catch(() => '(none)')}`);

    await popover.getByRole('button', { name: 'Show summary' }).click();
    await page.screenshot({ path: join(root, 'e2e/output/real-gemini-summary.png') });

    const { usage } = await worker.evaluate(() => chrome.storage.local.get('usage'));
    console.log(`Counted towards the daily limit: ${usage?.seconds}s`);

    await page.keyboard.press('Escape');
    await thumbnail.hover();
    await button.click();
    await popover.getByRole('button', { name: 'Ask again' }).waitFor({ timeout: 5000 });
    console.log('Reopening used the saved answer');
  }
} catch (err) {
  failed = true;
  console.log(`FAILED: ${String(err.message).split('\n')[0]}`);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
