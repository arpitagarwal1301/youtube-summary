import type { AnswerLanguage } from './types';

export const MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (recommended)' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (newest, can be too busy to answer)' },
  { id: 'gemini-flash-latest', label: 'Latest Flash (Google picks the version)' },
] as const;

export const DEFAULT_MODEL = MODELS[0].id;
/** Used when the chosen model is overloaded or out of quota. */
export const FALLBACK_MODEL = DEFAULT_MODEL;

export interface Settings {
  apiKey: string;
  model: string;
  language: AnswerLanguage;
  prefetch: boolean;
}

const DEFAULTS: Settings = { apiKey: '', model: DEFAULT_MODEL, language: 'english', prefetch: true };

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(stored.settings as Partial<Settings> | undefined) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings });
}
