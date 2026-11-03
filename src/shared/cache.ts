import type { AnswerLanguage, VideoAnswer } from './types';

/** Bump when the prompt or answer shape changes, so old answers are not reused. */
const PROMPT_VERSION = 5;
const PREFIX = 'answer:';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

interface Entry {
  answer: VideoAnswer;
  savedAt: number;
}

export function cacheKey(videoId: string, language: AnswerLanguage): string {
  return `${PREFIX}${PROMPT_VERSION}:${language}:${videoId}`;
}

export async function readCached(key: string, now = Date.now()): Promise<VideoAnswer | null> {
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key] as Entry | undefined;
  if (!entry || now - entry.savedAt > TTL_MS) return null;
  return entry.answer;
}

/** Returns which of these keys have a saved answer that is still fresh. */
export async function findCached(keys: string[], now = Date.now()): Promise<Set<string>> {
  const stored = await chrome.storage.local.get(keys);
  return new Set(keys.filter((key) => {
    const entry = stored[key] as Entry | undefined;
    return entry && now - entry.savedAt <= TTL_MS;
  }));
}

export async function writeCached(key: string, answer: VideoAnswer, now = Date.now()): Promise<void> {
  await chrome.storage.local.set({ [key]: { answer, savedAt: now } satisfies Entry });

  const entries = await allEntries();
  const excess = entries.length - MAX_ENTRIES;
  if (excess > 0) {
    const oldest = entries.sort((a, b) => a[1].savedAt - b[1].savedAt).slice(0, excess);
    await chrome.storage.local.remove(oldest.map(([entryKey]) => entryKey));
  }
}

export async function countCached(): Promise<number> {
  return (await allEntries()).length;
}

export async function clearCached(): Promise<void> {
  await chrome.storage.local.remove((await allEntries()).map(([key]) => key));
}

async function allEntries(): Promise<[string, Entry][]> {
  const stored = await chrome.storage.local.get(null);
  return Object.entries(stored).filter((pair): pair is [string, Entry] => pair[0].startsWith(PREFIX));
}
