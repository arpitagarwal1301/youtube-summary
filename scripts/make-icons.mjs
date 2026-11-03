// Renders the extension icons. Only needs re-running if the design changes.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');
await mkdir(out, { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <path fill="#065fd4" d="M28 8h72a20 20 0 0 1 20 20v52a20 20 0 0 1-20 20H62l-26 22V100h-8A20 20 0 0 1 8 80V28A20 20 0 0 1 28 8z"/>
  <path fill="#ffffff" d="M52 30l40 24-40 24z"/>
</svg>`;

const browser = await chromium.launch();
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: join(out, `icon${size}.png`), omitBackground: true });
  await page.close();
}
await browser.close();
