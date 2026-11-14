import type { AnswerLanguage } from './types';

/** The model setting for people who have not pinned one. Which model that means comes from the remote settings file. */
export const AUTO_MODEL = 'auto';
const SETTINGS_VERSION = 2;

export interface Settings {
  apiKey: string;
  /** AUTO_MODEL, or the ID of a model the user pinned. */
  model: string;
  language: AnswerLanguage;
  /** Answer each video the user opens, without a click. */
  autoAnswer: boolean;
  /** Desktop notification when an answer finishes while YouTube is not in view. */
  notifications: boolean;
}

const DEFAULTS: Settings = { apiKey: '', model: AUTO_MODEL, language: 'english', autoAnswer: false, notifications: true };

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get('settings');
  const saved = stored.settings as (Partial<Settings> & { version?: number }) | undefined;
  if (!saved) return { ...DEFAULTS };
  return {
    apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : '',
    // Version 1 saved a specific model even for people who never chose one, so only a later choice counts.
    model: saved.version === SETTINGS_VERSION && saved.model ? saved.model : AUTO_MODEL,
    language: saved.language === 'video' ? 'video' : 'english',
    autoAnswer: saved.autoAnswer === true,
    notifications: saved.notifications !== false,
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings: { ...settings, version: SETTINGS_VERSION } });
}

export async function updateSettings(change: Partial<Settings>): Promise<Settings> {
  const settings = { ...(await getSettings()), ...change };
  await saveSettings(settings);
  return settings;
}

/** The model to ask, and the one to try if it is busy or out of quota. Limits are per model, so the second can often still answer. */
export function resolveModels(model: string, models: { auto: string; fallback: string }): { model: string; fallbackModel: string } {
  const primary = model === AUTO_MODEL ? models.auto : model;
  return { model: primary, fallbackModel: primary === models.auto ? models.fallback : models.auto };
}
