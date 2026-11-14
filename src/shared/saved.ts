import type { AnswerLanguage, RequestSource, VideoAnswer, VideoRef } from './types';

/** Bump when the prompt or answer shape changes, so answers in an old shape are dropped. */
const FORMAT_VERSION = 6;
const PREFIX = 'answer:';
const CURRENT_PREFIX = `${PREFIX}${FORMAT_VERSION}:`;
/** Answers are a record of today, not an archive. */
export const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

export interface SavedAnswer {
  video: Pick<VideoRef, 'videoId' | 'title' | 'channel' | 'durationSeconds' | 'isShort'>;
  answer: VideoAnswer;
  savedAt: number;
  source: RequestSource;
}

export function answerKey(videoId: string, language: AnswerLanguage): string {
  return `${CURRENT_PREFIX}${language}:${videoId}`;
}

function isFresh(entry: SavedAnswer | undefined, now: number): entry is SavedAnswer {
  return !!entry && typeof entry.savedAt === 'number' && now - entry.savedAt <= KEEP_MS;
}

export async function readSaved(key: string, now = Date.now()): Promise<SavedAnswer | null> {
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key] as SavedAnswer | undefined;
  return isFresh(entry, now) ? entry : null;
}

/** Returns which of these keys have a saved answer that is still fresh. */
export async function findSaved(keys: string[], now = Date.now()): Promise<Set<string>> {
  const stored = await chrome.storage.local.get(keys);
  return new Set(keys.filter((key) => isFresh(stored[key] as SavedAnswer | undefined, now)));
}

export async function writeSaved(key: string, entry: SavedAnswer): Promise<void> {
  await chrome.storage.local.set({ [key]: entry });
  await removeOld(entry.savedAt);
}

/** Today's answers, newest first. */
export async function listSaved(now = Date.now()): Promise<SavedAnswer[]> {
  const stored = await chrome.storage.local.get(null);
  return Object.entries(stored)
    .filter((pair): pair is [string, SavedAnswer] => pair[0].startsWith(CURRENT_PREFIX) && isFresh(pair[1] as SavedAnswer, now))
    .map(([, entry]) => entry)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function clearSaved(): Promise<void> {
  const stored = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(stored).filter((key) => key.startsWith(PREFIX)));
}

/** Removes answers past a day, answers saved in an older shape, and the oldest past the limit. */
export async function removeOld(now = Date.now()): Promise<void> {
  const stored = await chrome.storage.local.get(null);
  const all = Object.entries(stored).filter(([key]) => key.startsWith(PREFIX));
  const kept = all.filter(([key, entry]) => key.startsWith(CURRENT_PREFIX) && isFresh(entry as SavedAnswer, now)) as [string, SavedAnswer][];
  const keptKeys = new Set(kept.map(([key]) => key));
  const remove = all.map(([key]) => key).filter((key) => !keptKeys.has(key));

  const excess = kept.length - MAX_ENTRIES;
  if (excess > 0) {
    const oldest = kept.sort((a, b) => a[1].savedAt - b[1].savedAt).slice(0, excess);
    remove.push(...oldest.map(([key]) => key));
  }
  if (remove.length > 0) await chrome.storage.local.remove(remove);
}

/** Video time the user did not have to sit through: the length of every video answered since `since`. */
export function savedSeconds(entries: SavedAnswer[], since = 0): number {
  return entries.filter((entry) => entry.savedAt >= since).reduce((total, entry) => total + (entry.video.durationSeconds ?? 0), 0);
}

/** Midnight at the start of the user's own day, which is what "today" means to them. */
export function startOfToday(now = Date.now()): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export async function savedToday(now = Date.now()): Promise<number> {
  return savedSeconds(await listSaved(now), startOfToday(now));
}
