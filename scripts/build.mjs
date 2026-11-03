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

async function copyStatic() {
  await mkdir(outDir, { recursive: true });
  await cp(join(root, 'public'), outDir, { recursive: true });
  await cp(join(root, 'src/offscreen/offscreen.html'), join(outDir, 'offscreen.html'));
  await cp(join(root, 'src/options/options.html'), join(outDir, 'options.html'));
  await cp(join(root, 'src/options/options.css'), join(outDir, 'options.css'));

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
    options: 'src/options/options.ts',
  },
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  outdir: outDir,
  define: { __GEMINI_BASE__: JSON.stringify(geminiBase) },
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
