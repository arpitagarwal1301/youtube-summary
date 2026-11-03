// Runs real videos through Gemini and reports speed, tokens and answers, without using the extension.
//
//   1. Put GEMINI_API_KEY=your-key in .env.local
//   2. npm run try-videos -- <youtube-url> <youtube-url> ...
//
// Options: --model=gemini-3.8-flash  --resolution=medium  --language=video
//          --title="..." replaces the headline, to test a title that hides the answer
//          --no-details leaves out the uploader's description and tags
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const urls = args.filter((arg) => !arg.startsWith('--'));

const env = await readFile(join(root, '.env.local'), 'utf8').catch(() => '');
const apiKey = env.match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim();
if (!apiKey) {
  console.error('Add GEMINI_API_KEY=your-key to .env.local first.');
  process.exit(1);
}
if (urls.length === 0) {
  console.error('Usage: npm run try-videos -- <youtube-url> [more urls] [--model=...] [--resolution=medium] [--language=video]');
  process.exit(1);
}

const tempDir = await mkdtemp(join(tmpdir(), 'know-it-'));
const bundle = join(tempDir, 'lib.mjs');
await build({
  absWorkingDir: root,
  stdin: {
    contents: `export { runGemini } from './src/background/gemini.ts';
      export { addPageDetails } from './src/background/details.ts';
      export { parseVideoId } from './src/shared/video.ts';
      export { DEFAULT_MODEL } from './src/shared/settings.ts';`,
    resolveDir: root,
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  define: { __GEMINI_BASE__: JSON.stringify('https://generativelanguage.googleapis.com') },
});
const { runGemini, addPageDetails, parseVideoId, DEFAULT_MODEL } = await import(pathToFileURL(bundle).href);
await rm(tempDir, { recursive: true, force: true });

const model = option('model', DEFAULT_MODEL);
const language = option('language', 'english');
const mediaResolution = option('resolution') === 'medium' ? 'MEDIA_RESOLUTION_MEDIUM' : 'MEDIA_RESOLUTION_LOW';
console.log(`Model: ${model}, resolution: ${mediaResolution}\n`);

for (const url of urls) {
  const videoId = parseVideoId(url);
  if (!videoId) {
    console.log(`SKIP ${url}: not a video link\n`);
    continue;
  }

  const details = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`)
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({}));

  let video = { videoId, title: option('title', details.title ?? ''), channel: details.author_name };
  if (args.includes('--no-details')) {
    video.channel = undefined;
  } else {
    video = await addPageDetails(video);
    console.log(`  Page details: ${video.keywords?.length ?? 0} tags, ${video.description?.length ?? 0} description characters`);
  }
  const startedAt = Date.now();
  const outcome = await runGemini({ video, apiKey, model, language }, mediaResolution);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`${video.title || videoId}\n${url}`);
  if (outcome.ok) {
    const { answer, videoTokens, modelVersion } = outcome;
    console.log(`  Took ${seconds}s, ${videoTokens} video tokens, answered by ${modelVersion ?? model}`);
    console.log(`  Type: ${answer.category}, confidence: ${answer.confidence}, delivers: ${answer.titleDelivers}`);
    if (answer.nameIsGuess) console.log('  WARNING SHOWN: the film or song name is not on the video page');
    console.log(`  Question: ${answer.question}`);
    console.log(`  Answer: ${answer.answer}`);
    if (answer.evidence) console.log(`  Check at: ${answer.evidence.seconds}s, ${answer.evidence.note}`);
    for (const point of answer.summary) console.log(`  - ${point}`);
  } else {
    console.log(`  FAILED after ${seconds}s [${outcome.error.code}]: ${outcome.error.message}`);
  }
  console.log('');
}
