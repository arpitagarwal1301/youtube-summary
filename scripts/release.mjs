// Releases a new version: `npm run release -- 1.2.0`.
// Write that version's notes at the top of CHANGELOG.md first, under "## 1.2.0".
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
const section = changelog.match(new RegExp(`^## ${version.replace(/\./g, '\\.')}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'))?.[1]?.trim();
if (!section) fail(`Add the notes for ${version} to CHANGELOG.md, under "## ${version}".`);

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
run('npm', ['run', 'package']);

if (dryRun) {
  console.log(`\nDry run: know-it.zip is built for ${version}. Nothing was committed or published.\n\n${section}`);
  process.exit(0);
}

run('git', ['add', 'package.json', 'package-lock.json', 'public/manifest.json']);
if (read('git', ['diff', '--cached', '--name-only']) !== '') run('git', ['commit', '-m', `Release ${version}`]);
run('git', ['tag', `v${version}`]);
run('git', ['push', 'origin', 'HEAD', `v${version}`]);
run('gh', ['release', 'create', `v${version}`, 'know-it.zip', '--title', `Know It ${version}`, '--notes', section]);
console.log(`\nReleased ${version}. Upload know-it.zip in the Chrome Web Store dashboard.`);
