import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheKey, clearCached, countCached, findCached, readCached, writeCached } from '../src/shared/cache';
import { DEFAULT_MODEL, getSettings, saveSettings } from '../src/shared/settings';
import type { VideoAnswer } from '../src/shared/types';
import { addUsedSeconds, getUsedSeconds, quotaDay, secondsForVideo } from '../src/shared/usage';

const answer: VideoAnswer = {
  category: 'other',
  question: '',
  answer: 'Yes',
  keyPoints: [],
  summary: [],
  confidence: 'high',
  titleDelivers: true,
};

beforeEach(() => {
  const data: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string | string[] | null) => {
          if (key === null) return { ...data };
          return Object.fromEntries([key].flat().map((name) => [name, data[name]]));
        },
        set: async (items: Record<string, unknown>) => void Object.assign(data, items),
        remove: async (keys: string[]) => keys.forEach((key) => delete data[key]),
      },
    },
  });
});

describe('answer cache', () => {
  it('keeps languages separate', async () => {
    await writeCached(cacheKey('abc', 'english'), answer);
    expect(await readCached(cacheKey('abc', 'english'))).toEqual(answer);
    expect(await readCached(cacheKey('abc', 'video'))).toBeNull();
  });

  it('expires after 30 days', async () => {
    const key = cacheKey('abc', 'english');
    await writeCached(key, answer, 0);
    expect(await readCached(key, 29 * 86_400_000)).toEqual(answer);
    expect(await readCached(key, 31 * 86_400_000)).toBeNull();
  });

  it('reports which answers are saved and still fresh', async () => {
    const fresh = cacheKey('fresh', 'english');
    const old = cacheKey('old', 'english');
    await writeCached(fresh, answer, 40 * 86_400_000);
    await writeCached(old, answer, 0);
    const found = await findCached([fresh, old, cacheKey('never', 'english')], 41 * 86_400_000);
    expect([...found]).toEqual([fresh]);
  });

  it('removes the oldest answers past the limit', async () => {
    for (let i = 0; i < 502; i++) await writeCached(cacheKey(`video${i}`, 'english'), answer, i);
    expect(await countCached()).toBe(500);
    expect(await readCached(cacheKey('video0', 'english'), 502)).toBeNull();
    expect(await readCached(cacheKey('video501', 'english'), 502)).toEqual(answer);
  });

  it('clearing leaves settings alone', async () => {
    await saveSettings({ apiKey: 'k', model: 'm', language: 'video', prefetch: false });
    await writeCached(cacheKey('abc', 'english'), answer);
    await clearCached();
    expect(await countCached()).toBe(0);
    expect((await getSettings()).apiKey).toBe('k');
  });
});

describe('settings', () => {
  it('has defaults before anything is saved', async () => {
    expect(await getSettings()).toEqual({ apiKey: '', model: DEFAULT_MODEL, language: 'english', prefetch: false });
  });

  it('leaves preparing in advance off for people who saved settings before it existed', async () => {
    await chrome.storage.local.set({ settings: { apiKey: 'k', model: 'm', language: 'video' } });
    expect((await getSettings()).prefetch).toBe(false);
  });

  it('keeps preparing in advance on once someone has chosen it', async () => {
    await saveSettings({ apiKey: 'k', model: 'm', language: 'video', prefetch: true });
    expect((await getSettings()).prefetch).toBe(true);
  });
});

describe('daily usage', () => {
  it('uses the Pacific calendar day', () => {
    expect(quotaDay(new Date('2026-11-03T07:59:00Z'))).toBe('2026-11-02');
    expect(quotaDay(new Date('2026-11-03T08:01:00Z'))).toBe('2026-11-03');
  });

  it('adds up within a day and resets the next day', async () => {
    const today = new Date('2026-11-03T12:00:00Z');
    await addUsedSeconds(100, today);
    await addUsedSeconds(50, today);
    expect(await getUsedSeconds(today)).toBe(150);
    expect(await getUsedSeconds(new Date('2026-11-04T12:00:00Z'))).toBe(0);
  });

  it('estimates from tokens when the length is unknown', () => {
    expect(secondsForVideo(600, 1)).toBe(600);
    expect(secondsForVideo(undefined, 12_000)).toBe(120);
  });
});
