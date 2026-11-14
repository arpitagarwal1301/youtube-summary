// Releases a new version: `npm run release -- 1.2.0`.
// Write that version's notes at the top of CHANGELOG.md first, under "## 1.2.0 — A few words". See RELEASING.md.
// Bumps the version, runs the checks, builds know-it.zip, commits, tags, pushes and creates the GitHub release.
// Pass --dry-run to stop before anything is committed or published.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const version = args.find((arg) => !arg.startsWith('--'));

const run = (command, commandArgs, options = {}) => execFileSync(command, commandArgs, { cwd: root, stdio: 'inherit', ...options });
const read = (command, commandArgs) => execFileSync(command, commandArgs, { cwd: root, encoding: 'utf8' }).trim();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('Usage: npm run release -- <major.minor.patch> [--dry-run]');

const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
const entry = changelog.match(new RegExp(`^## ${version.replace(/\./g, '\\.')}(?: — (.+))?\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
const section = entry?.[2]?.trim();
if (!section) fail(`Add the notes for ${version} to CHANGELOG.md, under "## ${version} — A few words".`);
const title = entry[1] ? `v${version} — ${entry[1].trim()}` : `v${version}`;
const notes = `${section}

## Install

1. Download **know-it.zip** below and unzip it.
2. Open \`chrome://extensions\` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped folder.

You need a free Gemini key from [Google AI Studio](https://aistudio.google.com/apikey). In the EU, the UK and Switzerland, Google allows only paid keys.`;

if (!dryRun && read('git', ['branch', '--show-current']) !== 'main') fail('Release from main, after the changelog is merged.');
if (!dryRun && read('git', ['status', '--porcelain']) !== '') fail('Commit or stash your changes first, so the release holds only what is committed.');
if (!dryRun && read('git', ['tag', '--list', `v${version}`]) !== '') fail(`v${version} is already tagged.`);

for (const file of ['package.json', 'public/manifest.json']) {
  const path = join(root, file);
  const json = JSON.parse(await readFile(path, 'utf8'));
  json.version = version;
  await writeFile(path, `${JSON.stringify(json, null, 2)}\n`);
}
run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--silent']);

run('npm', ['run', 'typecheck']);
run('npm', ['test']);
run('npm', ['run', 'check-docs']);
run('npm', ['run', 'package']);

if (dryRun) {
  console.log(`\nDry run: know-it.zip is built for ${version}. Nothing was committed or published.\n\n# ${title}\n\n${notes}`);
  process.exit(0);
}

run('git', ['add', 'package.json', 'package-lock.json', 'public/manifest.json']);
if (read('git', ['diff', '--cached', '--name-only']) !== '') run('git', ['commit', '-m', `Release ${version}`]);
run('git', ['tag', `v${version}`]);
run('git', ['push', 'origin', 'HEAD', `v${version}`]);
run('gh', ['release', 'create', `v${version}`, 'know-it.zip', '--title', title, '--notes', notes, '--latest']);
console.log(`\nReleased ${version}. Upload know-it.zip in the Chrome Web Store dashboard.`);
