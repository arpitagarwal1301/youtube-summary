import { GEMINI_BASE } from '../background/gemini';
import { clearCached, countCached } from '../shared/cache';
import { MODELS, getSettings, saveSettings } from '../shared/settings';
import type { AnswerLanguage } from '../shared/types';
import { DAILY_LIMIT_SECONDS, getUsedSeconds } from '../shared/usage';

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const keyInput = byId<HTMLInputElement>('api-key');
const toggleKey = byId<HTMLButtonElement>('toggle-key');
const saveKey = byId<HTMLButtonElement>('save-key');
const keyStatus = byId<HTMLSpanElement>('key-status');
const modelSelect = byId<HTMLSelectElement>('model');
const languageSelect = byId<HTMLSelectElement>('language');
const prefetchToggle = byId<HTMLInputElement>('prefetch');

function setStatus(text: string, tone: 'good' | 'bad' | '' = ''): void {
  keyStatus.textContent = text;
  keyStatus.className = tone;
}

async function testKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch(`${GEMINI_BASE}/v1beta/models?pageSize=1`, {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (response.ok) return { ok: true, message: 'Saved. The key works.' };
    return { ok: false, message: 'Saved, but Gemini did not accept this key.' };
  } catch {
    return { ok: false, message: 'Saved, but Gemini could not be reached to test it.' };
  }
}

async function updateSetting(change: { model?: string; language?: AnswerLanguage; prefetch?: boolean }): Promise<void> {
  await saveSettings({ ...(await getSettings()), ...change });
}

function describeHours(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

async function renderUsage(): Promise<void> {
  const used = await getUsedSeconds();
  const percent = Math.min(100, Math.round((used / DAILY_LIMIT_SECONDS) * 100));
  byId('usage-fill').style.width = `${percent}%`;
  byId('usage-meter').setAttribute('aria-valuenow', String(percent));
  byId('usage-text').textContent = `${describeHours(used)} of ${DAILY_LIMIT_SECONDS / 3600} hours used today.`;
}

async function renderCache(): Promise<void> {
  const count = await countCached();
  byId('cache-text').textContent = count === 1 ? '1 answer saved.' : `${count} answers saved.`;
  byId<HTMLButtonElement>('clear-cache').disabled = count === 0;
}

async function init(): Promise<void> {
  for (const model of MODELS) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.label;
    modelSelect.append(option);
  }

  const settings = await getSettings();
  keyInput.value = settings.apiKey;
  modelSelect.value = settings.model;
  languageSelect.value = settings.language;
  prefetchToggle.checked = settings.prefetch;

  toggleKey.addEventListener('click', () => {
    const hidden = keyInput.type === 'password';
    keyInput.type = hidden ? 'text' : 'password';
    toggleKey.textContent = hidden ? 'Hide' : 'Show';
  });

  saveKey.addEventListener('click', async () => {
    const apiKey = keyInput.value.trim();
    keyInput.value = apiKey;
    saveKey.disabled = true;
    await saveSettings({ ...(await getSettings()), apiKey });
    if (apiKey) {
      setStatus('Testing…');
      const result = await testKey(apiKey);
      setStatus(result.message, result.ok ? 'good' : 'bad');
    } else {
      setStatus('Key removed.');
    }
    saveKey.disabled = false;
  });

  modelSelect.addEventListener('change', () => void updateSetting({ model: modelSelect.value }));
  languageSelect.addEventListener('change', () => {
    void updateSetting({ language: languageSelect.value as AnswerLanguage });
  });

  prefetchToggle.addEventListener('change', () => void updateSetting({ prefetch: prefetchToggle.checked }));

  byId('clear-cache').addEventListener('click', async () => {
    await clearCached();
    await renderCache();
  });

  await Promise.all([renderUsage(), renderCache()]);
  chrome.storage.local.onChanged.addListener(() => {
    void renderUsage();
    void renderCache();
  });
}

void init();
