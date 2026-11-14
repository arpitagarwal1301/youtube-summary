// Checks the docs agree with the code: `npm run check-docs`.
// Runs in CI and in the pre-push hook (.githooks/pre-push). Exits non-zero on any problem.
//   - package.json and public/manifest.json have the same version, and CHANGELOG.md has a section for it.
//   - Relative links in the Markdown files point at files that exist.
//   - Workflow badges point at workflows that exist.
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const readJson = async (file) => JSON.parse(await readFile(join(root, file), 'utf8'));
const { version } = await readJson('package.json');
const manifest = await readJson('public/manifest.json');
if (manifest.version !== version) problems.push(`public/manifest.json is ${manifest.version}, but package.json is ${version}.`);

const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
if (!new RegExp(`^## ${version.replace(/\./g, '\\.')}( |$)`, 'm').test(changelog)) {
  problems.push(`CHANGELOG.md has no "## ${version}" section.`);
}

/** Markdown files outside dependencies and build output. */
async function markdownFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'dist-e2e', '.git'].includes(entry.name) || entry.name.startsWith('output')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownFiles(path)));
    else if (entry.name.endsWith('.md')) found.push(path);
  }
  return found;
}

for (const file of await markdownFiles(root)) {
  const text = await readFile(file, 'utf8');
  const name = relative(root, file);
  // Markdown links and HTML src/href attributes.
  const targets = [...text.matchAll(/\]\(([^)\s]+)\)/g), ...text.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  for (const target of targets) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = decodeURIComponent(target.split('#')[0]);
    if (path && !existsSync(join(dirname(file), path))) problems.push(`${name} links to ${target}, which doesn't exist.`);
  }
  for (const match of text.matchAll(/actions\/workflows\/([\w.-]+\.ya?ml)/g)) {
    if (!existsSync(join(root, '.github/workflows', match[1]))) problems.push(`${name} has a badge for ${match[1]}, which isn't a workflow.`);
  }
}

if (problems.length > 0) {
  console.error(`Docs check found ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Docs check passed for ${version}.`);
