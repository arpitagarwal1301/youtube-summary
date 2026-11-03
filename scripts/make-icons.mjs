// Renders the extension icons. Only needs re-running if the design changes.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');
await mkdir(out, { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="warm" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffd166"/>
      <stop offset="1" stop-color="#ff7a59"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="112" height="112" rx="26" fill="#211c1a"/>
  <g fill="url(#warm)" transform="translate(17 18) scale(3.9)">
    <path d="M9.5 4 11 9.5 16.5 11 11 12.5 9.5 18 8 12.5 2.5 11 8 9.5Z"/>
    <path d="M18 2 18.8 5.2 22 6 18.8 6.8 18 10 17.2 6.8 14 6 17.2 5.2Z"/>
    <path d="M18 14.5 18.6 16.9 21 17.5 18.6 18.1 18 20.5 17.4 18.1 15 17.5 17.4 16.9Z"/>
  </g>
</svg>`;

const browser = await chromium.launch();
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: join(out, `icon${size}.png`), omitBackground: true });
  await page.close();
}
await browser.close();
