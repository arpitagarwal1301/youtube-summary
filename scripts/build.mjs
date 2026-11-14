import { context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

// End-to-end tests build a separate copy pointed at a local mock server.
const mockBase = process.env.GEMINI_MOCK_BASE;
const outDir = join(root, mockBase ? 'dist-e2e' : 'dist');
const geminiBase = mockBase ?? 'https://generativelanguage.googleapis.com';
// A small file of corrections in this repository, read at most once a day. See src/shared/remote.ts.
const configUrl = mockBase
  ? `${mockBase}/remote-config.json`
  : 'https://raw.githubusercontent.com/arpitagarwal1301/youtube-summary/main/remote-config.json';

async function copyStatic() {
  await mkdir(outDir, { recursive: true });
  await cp(join(root, 'public'), outDir, { recursive: true });
  await cp(join(root, 'src/offscreen/offscreen.html'), join(outDir, 'offscreen.html'));
  await cp(join(root, 'src/panel/panel.html'), join(outDir, 'panel.html'));
  await cp(join(root, 'src/panel/panel.css'), join(outDir, 'panel.css'));
  await cp(join(root, 'src/setup/setup.html'), join(outDir, 'setup.html'));

  if (mockBase) {
    const manifestPath = join(outDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.host_permissions.push(`${mockBase}/*`);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }
}

await rm(outDir, { recursive: true, force: true });
await copyStatic();

const ctx = await context({
  absWorkingDir: root,
  entryPoints: {
    background: 'src/background/index.ts',
    content: 'src/content/index.ts',
    offscreen: 'src/offscreen/offscreen.ts',
    panel: 'src/panel/panel.ts',
    setup: 'src/setup/setup.ts',
  },
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  outdir: outDir,
  define: { __GEMINI_BASE__: JSON.stringify(geminiBase), __CONFIG_URL__: JSON.stringify(configUrl) },
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
