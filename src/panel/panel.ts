import { GEMINI_BASE } from '../background/gemini';
import { createLineIcon } from '../content/icon';
import { appendHighlighted, element } from '../content/popover';
import { getRemoteConfig, refreshRemoteConfig, type RemoteConfig } from '../shared/remote';
import { clearSaved, listSaved, savedSeconds, startOfToday, type SavedAnswer } from '../shared/saved';
import { AUTO_MODEL, getSettings, updateSettings } from '../shared/settings';
import { shareText } from '../shared/share';
import { getStats, shouldNudgeSponsor, updateStats } from '../shared/stats';
import type { AnswerLanguage, VideoRef } from '../shared/types';
import { DAILY_LIMIT_SECONDS, describeDuration, getUsedSeconds, nextReset } from '../shared/usage';
import { formatClock, watchUrl } from '../shared/video';
import { maskedKey, renderKeyForm } from './keyform';

/** As the service worker stores them. Only the fields shown here. */
interface RunningJob {
  video: VideoRef;
  startedAt: number;
}
const JOB_STALE_MS = 5 * 60 * 1000;
const COPIED_FOR_MS = 1800;
/** Model families that cannot watch a video and answer in text. */
const NOT_FOR_VIDEO = /image|tts|audio|live|embedding|robotics|computer|antigravity/;

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const params = new URLSearchParams(location.search);
if (params.has('tab')) document.body.classList.add('tab');
/** Shown in a drop-down on YouTube, below Know It's button in the top bar. */
const embedded = params.has('embed');
if (embedded) {
  document.body.classList.add('embed');
  // Follows YouTube's theme there, rather than the system's.
  document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
}
/** On YouTube, a video opens in the same tab. Elsewhere, in a new one. */
const VIDEO_TARGET = embedded ? '_top' : '_blank';

function closeEmbedded(): void {
  window.parent.postMessage({ type: 'know-it-close' }, 'https://www.youtube.com');
}

/** Copies text. In YouTube's drop-down the frame may not be allowed to, so the page copies it instead. */
async function copyText(text: string): Promise<boolean> {
  const done = await navigator.clipboard.writeText(text).then(() => true, () => false);
  if (done || !embedded) return done;
  return new Promise<boolean>((resolve) => {
    const id = crypto.randomUUID();
    const finish = (ok: boolean) => {
      window.removeEventListener('message', onReply);
      window.clearTimeout(timer);
      resolve(ok);
    };
    const onReply = (event: MessageEvent) => {
      const data = event.data as { type?: string; id?: string; ok?: boolean } | null;
      if (event.origin === 'https://www.youtube.com' && event.source === window.parent && data?.type === 'know-it-copied' && data.id === id) finish(data.ok === true);
    };
    const timer = window.setTimeout(() => finish(false), 2000);
    window.addEventListener('message', onReply);
    window.parent.postMessage({ type: 'know-it-copy', id, text }, 'https://www.youtube.com');
  });
}

const expanded = new Set<string>(location.hash.length > 1 ? [location.hash.slice(1)] : []);
let config: RemoteConfig;

/** Below this, the panel mentions what is left of the day's free video. Above it, the number would only make people ration. */
const LOW_LIMIT_SECONDS = 60 * 60;

async function renderLimit(entries: SavedAnswer[]): Promise<void> {
  const saved = savedSeconds(entries, startOfToday());
  const savedLine = byId('saved-today');
  savedLine.hidden = saved < 60;
  savedLine.replaceChildren(element('strong', undefined, describeDuration(saved)), document.createTextNode(' saved today'));

  const left = Math.max(0, DAILY_LIMIT_SECONDS - (await getUsedSeconds()));
  const note = byId('limit-note');
  const { apiKey } = await getSettings();
  note.hidden = !apiKey || left >= LOW_LIMIT_SECONDS;
  if (note.hidden) return;
  const reset = nextReset().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  note.textContent =
    left === 0
      ? `Today's ${DAILY_LIMIT_SECONDS / 3600} free hours of video are used. More at ${reset}.`
      : `${describeDuration(left)} of free video left today. More at ${reset}.`;
}

function loadingRow(job: RunningJob): HTMLLIElement {
  const item = element('li', 'item loading');
  const head = element('div', 'item-head');
  const text = element('div');
  const seconds = Math.max(0, Math.round((Date.now() - job.startedAt) / 1000));
  text.append(element('span', 'item-title', job.video.title || 'Video'), element('p', 'item-answer', `Watching the video… ${seconds}s`));
  head.append(thumbnail(job.video.videoId), text);
  item.append(head);
  return item;
}

function thumbnail(videoId: string): HTMLImageElement {
  const image = element('img', 'thumb');
  image.src = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
  image.alt = '';
  image.loading = 'lazy';
  return image;
}

function answerRow(entry: SavedAnswer): HTMLLIElement {
  const { video, answer } = entry;
  const item = element('li', 'item');
  item.dataset.id = video.videoId;

  const title = element('a', 'item-title', video.title || 'Video');
  title.href = watchUrl(video.videoId);
  title.target = VIDEO_TARGET;
  title.rel = 'noopener noreferrer';
  title.title = 'Open the video';
  const line = element('p', 'item-answer');
  appendHighlighted(line, answer.answer);
  const text = element('div');
  text.append(title, line);

  const details = element('div', 'details');
  const open = expanded.has(video.videoId);
  details.hidden = !open;
  // Closed, a long answer is cut to a few lines so the list stays short.
  item.classList.toggle('open', open);
  const toggle = element('button', 'expand');
  toggle.setAttribute('aria-label', 'Show the key points and summary');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.addEventListener('click', () => {
    details.hidden = !details.hidden;
    toggle.setAttribute('aria-expanded', String(!details.hidden));
    item.classList.toggle('open', !details.hidden);
    if (details.hidden) expanded.delete(video.videoId);
    else expanded.add(video.videoId);
  });

  for (const [points, className] of [[answer.keyPoints, ''], [answer.summary, 'rest']] as const) {
    if (points.length === 0) continue;
    const list = element('ul', className);
    for (const point of points) {
      const row = element('li');
      appendHighlighted(row, point, 'strong');
      list.append(row);
    }
    details.append(list);
  }
  const actions = element('div', 'details-actions');
  if (answer.evidence) {
    const moment = element('a', 'action');
    moment.append(createLineIcon('play'), element('span', undefined, `Check it at ${formatClock(answer.evidence.seconds)}`));
    moment.href = watchUrl(video.videoId, answer.evidence.seconds);
    moment.target = VIDEO_TARGET;
    moment.rel = 'noopener noreferrer';
    actions.append(moment);
  }
  const copy = element('button', 'action');
  const copyLabel = (icon: 'copy' | 'check', text: string) => copy.replaceChildren(createLineIcon(icon), element('span', undefined, text));
  copyLabel('copy', 'Copy');
  copy.addEventListener('click', async () => {
    const done = await copyText(shareText(video, answer, config.links.share));
    copyLabel(done ? 'check' : 'copy', done ? 'Copied' : 'Could not copy');
    window.setTimeout(() => copyLabel('copy', 'Copy'), COPIED_FOR_MS);
  });
  actions.append(copy);
  details.append(actions);

  const head = element('div', 'item-head');
  head.append(thumbnail(video.videoId), text, toggle);
  item.append(head, details);
  return item;
}

async function renderAnswers(): Promise<void> {
  const [entries, stored] = await Promise.all([listSaved(), chrome.storage.session.get('jobs')]);
  const now = Date.now();
  const running = Object.values((stored.jobs ?? {}) as Record<string, RunningJob>)
    .filter((job) => now - job.startedAt < JOB_STALE_MS)
    .sort((a, b) => b.startedAt - a.startedAt);

  byId('list').replaceChildren(...running.map(loadingRow), ...entries.map(answerRow));
  byId('empty').hidden = running.length + entries.length > 0;
  const total = running.length + entries.length;
  byId('count').textContent = total > 0 ? String(total) : '';
  byId('saved-count').textContent = entries.length === 1 ? '1 answer saved' : `${entries.length} answers saved`;
  byId<HTMLButtonElement>('clear').disabled = entries.length === 0;
  await renderLimit(entries);
}

async function renderKey(): Promise<void> {
  const { apiKey } = await getSettings();
  byId('setup').hidden = !!apiKey;
  // Nothing to switch on until there is a key.
  byId('auto-section').hidden = !apiKey;
  byId('key-mask').textContent = await maskedKey();
  byId('key-change').textContent = apiKey ? 'Change' : 'Add';
  if (!apiKey && !byId('key-form').hasChildNodes()) renderKeyForm(byId('key-form'), config.links.getKey, () => void renderKey());
}

/** Fills the model list from Google itself, so a new model can be chosen without waiting for a new version of this extension. */
async function loadModels(): Promise<void> {
  const select = byId<HTMLSelectElement>('model');
  const { apiKey, model } = await getSettings();
  const names = new Map<string, string>();
  if (apiKey) {
    try {
      const response = await fetch(`${GEMINI_BASE}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
      const body = (await response.json()) as { models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[] };
      for (const entry of body.models ?? []) {
        const id = (entry.name ?? '').replace(/^models\//, '');
        if (!id.includes('flash') || NOT_FOR_VIDEO.test(id) || !entry.supportedGenerationMethods?.includes('generateContent')) continue;
        names.set(id, entry.displayName || id);
      }
    } catch {
      byId('model-help').textContent = 'Could not load the list from Google. Automatic still works.';
    }
  }
  // A pinned model stays listed even if Google no longer offers it, so the choice is visible and can be changed.
  if (model !== AUTO_MODEL && !names.has(model)) names.set(model, `${model} (no longer listed)`);

  const automatic = element('option', undefined, `Automatic (recommended): ${config.models.auto}`);
  automatic.value = AUTO_MODEL;
  select.replaceChildren(automatic, ...[...names].map(([id, label]) => {
    const option = element('option', undefined, label);
    option.value = id;
    return option;
  }));
  select.value = model;
}

/** Settings take the place of the answers while open, so neither has to sit at the bottom of the other. */
function showSettings(open: boolean): void {
  byId('main').classList.toggle('settings-open', open);
  byId('settings').hidden = !open;
  byId('home').hidden = open;
  byId('settings-toggle').setAttribute('aria-expanded', String(open));
  window.scrollTo(0, 0);
}

function disclose(buttonId: string, panelId: string, onOpen?: () => void): void {
  const button = byId(buttonId);
  const panel = byId(panelId);
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) onOpen?.();
  });
}

async function init(): Promise<void> {
  config = await getRemoteConfig();
  const settings = await getSettings();
  const version = chrome.runtime.getManifest().version;

  byId('welcome').hidden = !params.has('welcome');
  if (embedded) {
    byId('close').hidden = false;
    byId('close').addEventListener('click', closeEmbedded);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeEmbedded();
    });
  }
  await renderKey();
  await renderAnswers();
  const target = location.hash.length > 1 ? document.querySelector(`[data-id="${CSS.escape(location.hash.slice(1))}"]`) : null;
  target?.scrollIntoView({ block: 'center' });

  const auto = byId<HTMLInputElement>('auto');
  auto.checked = settings.autoAnswer;
  auto.addEventListener('change', () => {
    void updateSettings({ autoAnswer: auto.checked });
    void updateStats((stats) => void (stats.autoOfferDone = true));
  });

  const language = byId<HTMLSelectElement>('language');
  language.value = settings.language;
  language.addEventListener('change', () => void updateSettings({ language: language.value as AnswerLanguage }));

  const notifications = byId<HTMLInputElement>('notifications');
  notifications.checked = settings.notifications;
  notifications.addEventListener('change', () => void updateSettings({ notifications: notifications.checked }));

  const model = byId<HTMLSelectElement>('model');
  model.addEventListener('change', () => void updateSettings({ model: model.value }));

  byId('settings-toggle').addEventListener('click', () => showSettings(byId('settings').hidden !== false));
  byId('settings-back').addEventListener('click', () => showSettings(false));
  disclose('advanced-toggle', 'advanced', () => void loadModels());
  byId('key-change').addEventListener('click', () => {
    const form = byId('key-change-form');
    form.hidden = !form.hidden;
    if (!form.hidden) renderKeyForm(form, config.links.getKey, () => void renderKey());
  });
  byId('clear').addEventListener('click', async () => {
    await clearSaved();
    await renderAnswers();
  });

  for (const [id, link] of [['github', config.links.github], ['sponsor', config.links.sponsor], ['feedback', config.links.feedback], ['whats-new', config.links.whatsNew], ['privacy', config.links.privacy], ['nudge-link', config.links.sponsor]] as const) {
    byId<HTMLAnchorElement>(id).href = link;
  }
  byId('version').textContent = `v${version}`;

  // After an update, a dot sits on "What's new" until it has been opened. Nothing ever opens by itself.
  const stats = await getStats();
  if (!stats.seenVersion) await updateStats((current) => void (current.seenVersion = version));
  else if (stats.seenVersion !== version) {
    // What's new is inside Settings, so the gear carries the dot too.
    byId('whats-new').classList.add('new');
    byId('settings-toggle').classList.add('new');
  }
  byId('whats-new').addEventListener('click', () => {
    byId('whats-new').classList.remove('new');
    byId('settings-toggle').classList.remove('new');
    void updateStats((current) => void (current.seenVersion = version));
  });

  if (shouldNudgeSponsor(stats)) {
    byId('nudge').hidden = false;
    await updateStats((current) => {
      current.sponsorShown++;
      current.sponsorLastShown = Date.now();
    });
  }
  const sponsorDone = (): void => {
    byId('nudge').hidden = true;
    void updateStats((current) => void (current.sponsorDone = true));
  };
  for (const id of ['nudge-link', 'nudge-close', 'sponsor']) byId(id).addEventListener('click', sponsorDone);

  if (config.notice) {
    const notice = byId('notice');
    notice.hidden = false;
    if (config.notice.url) {
      const link = element('a', undefined, config.notice.text);
      link.href = config.notice.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      notice.replaceChildren(link);
    } else {
      notice.textContent = config.notice.text;
    }
  }

  // Opening the panel counts as having seen whatever arrived while YouTube was out of view.
  await chrome.storage.session.set({ unseen: {} });
  await chrome.action.setBadgeText({ text: '' });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && 'jobs' in changes) void renderAnswers();
    if (area === 'local' && Object.keys(changes).some((key) => key.startsWith('answer:') || key === 'usage')) void renderAnswers();
    if (area === 'local' && 'settings' in changes) void renderKey();
  });
  // Keeps the seconds moving on answers that are still loading.
  window.setInterval(() => {
    if (document.querySelector('.item.loading')) void renderAnswers();
  }, 1000);

  void refreshRemoteConfig();
}

void init();
